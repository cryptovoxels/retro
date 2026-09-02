import { app } from '../state'
import { format } from 'timeago.js'
import { dayOfWeek, intervalAsString, isInFuture, isInPast, isLive, isToday, isTomorrow, milliSecondsToInterval, monthOfYear, nth } from '../../../common/helpers/time-helpers'
import ParcelHelper from '../../../common/helpers/parcel-helper'
import { fetchFromMPServer } from '../../../common/helpers/utils'
import { PanelType } from '../components/panel'
import { Event } from '../../../common/messages/event'
import { avatarName, avatarSlug } from '../../../common/messages/avatar-ref'

export default class ParcelEvent {
  ev: Event

  starts_at: Date
  expires_at: Date
  players_present = 0
  _teleport_string: string | null = null
  teleportFetch: Promise<string> | null = null

  constructor(obj: Event) {
    this.ev = obj
    this.starts_at = new Date(obj.starts_at)
    this.expires_at = new Date(obj.expires_at)
  }

  get author() {
    return this.ev.author // AvatarRef
  }

  get authorSlug() {
    return avatarSlug(this.ev.author)
  }

  get name() {
    return this.ev.name
  }

  get parcel_id() {
    return this.ev.parcel_id
  }

  get parcel_name() {
    return this.ev.parcel_name
  }

  get parcel_address() {
    return this.ev.parcel_address
  }

  get id() {
    return this.ev.id
  }

  get latLng() {
    return { lat: this.center[1], lng: this.center[0] }
  }

  get centroid(): [number, number] {
    let x = 0
    let y = 0
    const coords = this.ev.geometry?.coordinates[0]

    if (!coords) return [0, 0]

    coords.forEach((tuple) => {
      x += tuple[0]
      y += tuple[1]
    })

    return [x / coords.length, y / coords.length]
  }

  get center(): [number, number] {
    return this.ev.parcel_x2 ? [(this.ev.parcel_x2 + this.ev.parcel_x1) / 200, (this.ev.parcel_z2 + this.ev.parcel_z1) / 200] : this.centroid
  }

  get eventTiming() {
    if (!this.starts_at || !this.expires_at) {
      return ''
    }
    const startTime = this.starts_at

    let day: string

    if (isToday(startTime)) {
      day = 'today'
    } else if (isTomorrow(startTime)) {
      day = 'tomorrow'
    } else {
      day = dayOfWeek(startTime) + ', ' + monthOfYear(startTime) + ' ' + startTime.getDate() + nth(startTime.getDate())
    }

    return day + ' ' + this.toLocaleTimeString({ timeStyle: 'short' })
  }

  get isInFuture(): boolean {
    return isInFuture(this.starts_at)
  }

  get isInPast(): boolean {
    return isInPast(this.expires_at)
  }

  get isLive(): boolean {
    return isLive(this.starts_at, this.expires_at)
  }

  get isOwner() {
    return app.isOwner(this.ev.author)
  }

  get canEdit() {
    if (app.state?.moderator) return true
    if (!this.ev.created_at) return false
    const week = 7 * 24 * 60 * 60 * 1000
    return Date.now() - new Date(this.ev.created_at).getTime() < week
  }

  get getContrastColor() {
    if (!this.ev.color) {
      this.ev.color = '#000000'
    }

    const hexcolor = this.ev.color.replace('#', '')
    const r = parseInt(hexcolor.substr(0, 2), 16)
    const g = parseInt(hexcolor.substr(2, 2), 16)
    const b = parseInt(hexcolor.substr(4, 2), 16)
    const yiq = (r * 299 + g * 587 + b * 114) / 1000
    return yiq >= 128 ? 'black' : 'white'
  }

  get expiredAgo() {
    return format(this.expires_at)
  }

  get startsIn() {
    return format(this.starts_at)
  }

  async getTeleportString() {
    if (!this._teleport_string) {
      await this.loadTeleportString()
    }
    return this._teleport_string
  }

  toLocale(options: Intl.DateTimeFormatOptions = {}) {
    return this.starts_at.toLocaleString('default', options)
  }

  toLocalDateString(options: Intl.DateTimeFormatOptions = {}) {
    return this.starts_at.toLocaleDateString('default', options)
  }

  toLocaleTimeString(options: Intl.DateTimeFormatOptions = {}) {
    return this.starts_at.toLocaleTimeString('default', options)
  }

  duration(from?: Date) {
    const s = from ?? new Date(this.starts_at)
    const e = new Date(this.expires_at)
    // round to the closest minute, otherwise it's pretty sure that it will round to like 59seconds
    const diff = Math.round((e.getTime() - s.getTime()) / 60_000) * 60_000
    return intervalAsString(milliSecondsToInterval(diff))
  }

  eventDescription(summary?: boolean) {
    if (!this.ev.description || typeof this.ev.description !== 'string') {
      return ''
    }

    let description = this.ev.description.trim()
    if (!summary) return description

    if (description.length < 255) return description

    const candidate = description.slice(0, 255)
    // find the last newline, comma or punctuation to find a natural place to shorten the description
    for (let i = candidate.length - 1; i > candidate.length / 2; i--) {
      if (['\n', ',', '.'].includes(candidate[i])) {
        description = description.slice(0, i + 1)
        break
      }
    }
    return description.trim() + ' …'
  }

  parcelNameOrAddress(maxChars?: number) {
    const n = this.parcel_name || this.parcel_address

    if (!n) {
      return ''
    }

    if (!maxChars || n.length < maxChars) return n
    return n.slice(0, maxChars)
  }

  authorNameOrAddress(maxChars?: number) {
    const n = avatarName(this.ev.author) || ''
    if (!maxChars || n.length < maxChars) return n
    return n.slice(0, maxChars)
  }

  eventName(maxChars?: number) {
    const n = this.name
    if (!maxChars || n.length < maxChars) return n
    return n.slice(0, maxChars)
  }

  async fetchPlayersPresent(callback?: (players: number) => void) {
    const data = await fetchFromMPServer<{ users?: any[] }>(`/api/parcels/${this.ev.parcel_id}.json`)

    if (data && data.users) {
      this.players_present = data.users.length
      !!callback && callback(data.users.length)
    }
  }

  formattedDate(useStartDate?: boolean) {
    const time = useStartDate ? this.starts_at : this.expires_at
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' }).format(time)
  }

  isToday() {
    return isToday(this.starts_at)
  }

  isTomorrow() {
    return isTomorrow(this.starts_at)
  }

  private async loadTeleportString() {
    if (this.teleportFetch) return this.teleportFetch
    try {
      const parcelObject = {
        x1: this.ev.parcel_x1,
        x2: this.ev.parcel_x2,
        y1: this.ev.y1,
        y2: this.ev.y2,
        z1: this.ev.parcel_z1,
        z2: this.ev.parcel_z2,
        geometry: this.ev.geometry,
        id: this.parcel_id,
      }
      const p = new ParcelHelper(parcelObject)
      this.teleportFetch = p.spawnUrl()
      this._teleport_string = await this.teleportFetch
    } catch (e) {
      console.error(e)
    } finally {
      this.teleportFetch = null
    }
  }
}

export async function removeEvent(event_id: number, callback?: (success: boolean) => void): Promise<void> {
  if (!confirm('Are you sure you want to delete this event?')) {
    return
  }
  const body = { id: event_id }
  const response = await fetch(`/api/events/remove`, {
    method: 'post',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!data.success) {
    app.showSnackbar('❌ Something went wrong...', PanelType.Danger)
  } else {
    callback && callback(true)
  }
}
