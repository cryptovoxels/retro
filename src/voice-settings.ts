import { createEvent, TypedEventTarget } from './utils/EventEmitter'

export type VoiceSettingsState = {
  enabled: boolean
  deviceId: string
  pitch: number
  monitor: boolean
}

const KEY = 'voice'

export class VoiceSettings extends TypedEventTarget<{ changed: VoiceSettingsState }> {
  private _enabled = true
  private _deviceId = 'default'
  private _pitch = 0
  private _monitor = false

  constructor() {
    super()
    const s = this.load()
    if ('enabled' in s) this._enabled = !!s.enabled
    if (typeof s.deviceId === 'string') this._deviceId = s.deviceId
    if (typeof s.pitch === 'number') this._pitch = s.pitch
    if ('monitor' in s) this._monitor = !!s.monitor
  }

  get enabled() {
    return this._enabled
  }

  set enabled(v: boolean) {
    this._enabled = v
    this.save()
    this.dispatchEvent(createEvent('changed', this.snapshot()))
  }

  get deviceId() {
    return this._deviceId
  }

  set deviceId(v: string) {
    this._deviceId = v || 'default'
    this.save()
    this.dispatchEvent(createEvent('changed', this.snapshot()))
  }

  get pitch() {
    return this._pitch
  }

  set pitch(v: number) {
    this._pitch = Math.max(-12, Math.min(12, v))
    this.save()
    this.dispatchEvent(createEvent('changed', this.snapshot()))
  }

  get monitor() {
    return this._monitor
  }

  set monitor(v: boolean) {
    this._monitor = v
    this.save()
    this.dispatchEvent(createEvent('changed', this.snapshot()))
  }

  snapshot(): VoiceSettingsState {
    return { enabled: this._enabled, deviceId: this._deviceId, pitch: this._pitch, monitor: this._monitor }
  }

  private load(): Partial<VoiceSettingsState> {
    if (typeof localStorage === 'undefined') return {}
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}') || {}
    } catch {
      return {}
    }
  }

  private save() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY, JSON.stringify(this.snapshot()))
  }
}

export const voiceSettings = new VoiceSettings()
