import { VoxelRadioEngine } from './engine'

let radio: VoxelRadioEngine | null = null
const ducks = new Set<object>()
const listeners = new Set<() => void>()
let broadcasting = false
let preBroadcastMaster = 1

function notify() {
  for (const fn of listeners) fn()
}

function syncDuck() {
  if (ducks.size > 0) radio?.duck()
  else radio?.unduck()
}

export function ensureRadio(): VoxelRadioEngine {
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

export function duckRadio(ref: object) {
  ducks.add(ref)
  syncDuck()
}

export function unduckRadio(ref: object) {
  if (!ducks.delete(ref)) return
  syncDuck()
}

export function setRadioVolume(v: number) {
  ensureRadio().setTrackVolume(v)
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
