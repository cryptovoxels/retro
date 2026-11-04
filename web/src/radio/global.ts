import { wantsAudio } from '../../../common/helpers/detector'
import { VoxelRadioEngine } from './engine'

let radio: VoxelRadioEngine | null = null
const ducks = new Set<object>()
const duckSrcs = new Map<object, [string, string?]>()
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
  for (const ref of ducks) {
    const s = duckSrcs.get(ref)
    if (s) return radio.duck(s[0], s[1])
  }
  radio.duck(null)
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
        if (typeof s.musicVolume === 'number') radio.setVolume(s.musicVolume)
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

// src is a playable url, shown as the title and used when the listener pins it
export function duckRadio(ref: object, src?: string, title?: string) {
  ducks.add(ref)
  if (src) duckSrcs.set(ref, [src, title])
  else duckSrcs.delete(ref)
  syncDuck()
  notify()
}

export function unduckRadio(ref: object) {
  if (!ducks.delete(ref)) return
  duckSrcs.delete(ref)
  syncDuck()
  notify()
}

export function setRadioVolume(v: number) {
  ensureRadio()?.setVolume(v)
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
