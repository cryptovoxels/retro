import { wantsAudio } from '../../../common/helpers/detector'
import { VoxelRadioEngine } from './engine'

let radio: VoxelRadioEngine | null = null
const ducks = new Set<object>()
const duckTitles = new Map<object, string>()
const listeners = new Set<() => void>()
let broadcasting = false
let preBroadcastMaster = 1

function notify() {
  for (const fn of listeners) fn()
}

function syncDuck() {
  if (!radio) return
  if (ducks.size === 0) {
    radio.unduck()
    return
  }
  let title: string | null = null
  for (const ref of ducks) {
    const t = duckTitles.get(ref)
    if (t) {
      title = t
      break
    }
  }
  radio.duck(title)
}

export function ensureRadio(): VoxelRadioEngine | null {
  if (!wantsAudio()) return null
  if (!radio) {
    radio = new VoxelRadioEngine()
    radio.onChange = notify
    radio.start()
    try {
      const stored = localStorage.getItem('audioSettings')
      if (stored) {
        const s = JSON.parse(stored)
        if (typeof s.musicVolume === 'number') radio.setTrackVolume(s.musicVolume)
      }
    } catch {}
  }
  return radio
}

export function getRadio() {
  return radio
}

export function onRadioChange(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function duckRadio(ref: object, title?: string) {
  ducks.add(ref)
  if (title) duckTitles.set(ref, title)
  else duckTitles.delete(ref)
  syncDuck()
  notify()
}

export function unduckRadio(ref: object) {
  if (!ducks.delete(ref)) return
  duckTitles.delete(ref)
  syncDuck()
  notify()
}

export function setRadioVolume(v: number) {
  ensureRadio()?.setTrackVolume(v)
}

export function setRadioBroadcasting(b: boolean) {
  const r = radio
  if (!r || broadcasting === b) return
  broadcasting = b
  if (b) {
    preBroadcastMaster = r.master.gain.value
    r.master.gain.value = 0
  } else {
    r.master.gain.value = r.muted ? 0 : preBroadcastMaster
  }
}
