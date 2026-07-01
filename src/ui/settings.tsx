import { Component, JSX } from 'preact'
import { isMobile } from '../../common/helpers/detector'
import { AudioSettings } from '../audio/audio-engine'
import { setRadioVolume } from '../../web/src/radio/global'
import Connector from '../connector'
import { FOV, NORMAL_FOV, WIDE_FOV } from '../graphic/field-of-view'
import { type GraphicEngine, GraphicLevels, GraphicSettings } from '../graphic/graphic-engine'
import type { MinimapSettings } from '../minimap'
import { chatSettings } from './interact/chat'
import { voiceSettings } from '../voice-settings'
import { DEFAULT_SENSITIVITY, MAX_SENSITIVITY, MIN_SENSITIVITY } from '../controls/user-control-settings'

function toReversedPercentage(value: number, min: number, max: number): number {
  return ((max - value) / (max - min)) * 100
}

function fromReversedPercentage(percentage: number, min: number, max: number): number {
  return max - (percentage / 100) * (max - min)
}

type PersistedAudio = AudioSettings & { musicVolume: number }
type AudioChannel = keyof PersistedAudio

function loadPersistedAudio(): PersistedAudio | undefined {
  let musicVolume = 1
  try {
    const stored = localStorage.getItem('audioSettings')
    if (stored) {
      const s = JSON.parse(stored)
      if (typeof s.musicVolume === 'number') musicVolume = s.musicVolume
    }
  } catch {}
  const engine = window._audio?.getSettings()
  if (engine) return { ...engine, musicVolume }
  return { parcelAudioVolume: 1, soundEffectsVolume: 1, musicVolume }
}

type Props = {
  scene: BABYLON.Scene
  minimapSettings: MinimapSettings
}

type InputDevice = { label: string; deviceId: string }

interface State {
  audio: PersistedAudio | undefined
  graphic: GraphicSettings
  fov: number
  minimap: MinimapSettings
  showMinimapSettings: boolean
  mouseSensitivityPercentage: number
  realisticLighting: boolean
  voiceEnabled: boolean
  voiceDeviceId: string
  voicePitch: number
  voiceMonitor: boolean
  voiceInputDevices: InputDevice[]
}

export class SettingsUI extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      audio: loadPersistedAudio(),
      graphic: this.graphicsEngine.getSettings(),
      fov: this.fov.value,
      minimap: this.minimap,
      showMinimapSettings: !window.config.isSpace,
      // we reverse the value as higher values are lower sensitivities
      mouseSensitivityPercentage: toReversedPercentage(this.cameraSettings.angularSensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY),
      realisticLighting: this.graphicsEngine.getSettings().realisticLighting ?? false,
      voiceEnabled: voiceSettings.enabled,
      voiceDeviceId: voiceSettings.deviceId,
      voicePitch: voiceSettings.pitch,
      voiceMonitor: voiceSettings.monitor,
      voiceInputDevices: [{ label: 'Default', deviceId: 'default' }],
    }

    this.fov.addEventListener(
      'changed',
      () => {
        if (this.fov.value !== this.state.fov) {
          this.setState({ fov: this.fov.value })
        }
      },
      { passive: true },
    )

    this.cameraSettings.addEventListener(
      'sensitivity-changed',
      () => {
        const mouseSensitivityPercentage = toReversedPercentage(this.cameraSettings.angularSensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY)
        if (mouseSensitivityPercentage !== this.state.mouseSensitivityPercentage) {
          this.setState({ mouseSensitivityPercentage: mouseSensitivityPercentage })
        }
      },
      { passive: true },
    )
  }

  componentDidMount() {
    if (typeof this.state.audio?.musicVolume === 'number') {
      setRadioVolume(this.state.audio.musicVolume)
    }
    this.refreshVoiceDevices()
    navigator.mediaDevices?.addEventListener('devicechange', this.refreshVoiceDevices)
    voiceSettings.addEventListener('changed', this.onVoiceSettingsChange)
  }

  componentWillUnmount() {
    navigator.mediaDevices?.removeEventListener('devicechange', this.refreshVoiceDevices)
    voiceSettings.removeEventListener('changed', this.onVoiceSettingsChange)
  }

  refreshVoiceDevices = () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const inputs = devices.filter((d) => d.kind === 'audioinput')
      if (!inputs.length || !inputs.some((d) => d.label)) {
        this.setState({ voiceInputDevices: [{ label: 'Default', deviceId: 'default' }] })
        return
      }
      this.setState({
        voiceInputDevices: [{ label: 'Default', deviceId: 'default' }, ...inputs.map((d) => ({ label: d.label || 'Microphone', deviceId: d.deviceId }))],
      })
    })
  }

  onVoiceSettingsChange = () => {
    this.setState({
      voiceEnabled: voiceSettings.enabled,
      voiceDeviceId: voiceSettings.deviceId,
      voicePitch: voiceSettings.pitch,
      voiceMonitor: voiceSettings.monitor,
    })
  }

  onToggleVoice(inputElement: HTMLInputElement) {
    voiceSettings.enabled = inputElement.checked
    this.forceUpdate()
  }

  onVoiceDeviceChange(e: InputEvent) {
    const el = e.currentTarget as HTMLSelectElement
    voiceSettings.deviceId = el.value
    this.forceUpdate()
  }

  onVoicePitchChange(e: InputEvent) {
    const el = e.currentTarget as HTMLInputElement
    voiceSettings.pitch = parseFloat(el.value)
    this.forceUpdate()
  }

  onToggleVoiceMonitor(inputElement: HTMLInputElement) {
    voiceSettings.monitor = inputElement.checked
    this.forceUpdate()
  }

  get audioEngine() {
    return window._audio
  }

  get graphicsEngine(): GraphicEngine {
    return window.graphic
  }

  get fov(): FOV {
    return window.fov
  }

  get cameraSettings() {
    return window.cameraSettings
  }

  get minimap(): MinimapSettings {
    return this.props.minimapSettings
  }

  get connector() {
    return window.connector as Connector
  }

  setStateAsync(state: any): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  async onVolumeChange(channel: AudioChannel, value: number) {
    if (!this.state.audio) return

    const audio = this.state.audio
    audio[channel] = value
    await this.setStateAsync({ audio })
    this.sendAudioSettings()
  }

  sendAudioSettings() {
    if (!this.state.audio) return
    const { musicVolume, ...engineSettings } = this.state.audio
    setRadioVolume(musicVolume)
    window.localStorage.setItem('audioSettings', JSON.stringify(this.state.audio))
    this.audioEngine?.setSettings(engineSettings)
  }

  onGraphicLevelChange(e: InputEvent) {
    const srcElement = e.currentTarget as HTMLInputElement
    const g = this.state.graphic
    const newLevel = parseInt(srcElement.value, 10) || 0
    const wasCustom = g.level === GraphicLevels.Custom
    const isPreset = newLevel !== GraphicLevels.Custom

    g.level = newLevel

    // Always enable sharpening for custom mode
    if (g.level === GraphicLevels.Custom) {
      g.customSharpening = true
    }

    this.setState({ graphic: g })
    this.sendGraphicsSettings()
  }

  onFOVChange(e: InputEvent) {
    const srcElement = e.currentTarget as HTMLInputElement
    const fov = parseFloat(srcElement.value)
    this.setState({ fov })
    this.fov.value = fov
  }

  onSensitivityChange(e: InputEvent) {
    const srcElement = e.currentTarget as HTMLInputElement
    const sensitivityPercentage = parseFloat(srcElement.value)
    console.debug('onSensitivityChange', sensitivityPercentage)
    const angularSensitivity = fromReversedPercentage(sensitivityPercentage, MIN_SENSITIVITY, MAX_SENSITIVITY)
    this.cameraSettings.angularSensitivity = angularSensitivity
  }

  onToggleMinimap(inputElement: HTMLInputElement) {
    const minimap = this.state.minimap
    minimap.enabled = inputElement.checked
    this.setStateAsync({ minimap })
  }

  onToggleMinimapZoom(inputElement: HTMLInputElement) {
    const minimap = this.state.minimap
    minimap.zoomed = inputElement.checked
    this.setStateAsync({ minimap })
  }

  onToggleMinimapRotate(inputElement: HTMLInputElement) {
    const minimap = this.state.minimap
    minimap.rotate = inputElement.checked
    this.setStateAsync({ minimap })
  }

  onToggleChat(inputElement: HTMLInputElement) {
    chatSettings.enabled = inputElement.checked
    this.forceUpdate()
  }

  onRealisticLightingChange(el: HTMLInputElement) {
    const g = this.state.graphic
    g.realisticLighting = el.checked
    this.setState({ graphic: g, realisticLighting: el.checked })
    this.sendGraphicsSettings()
  }

  sendGraphicsSettings() {
    this.graphicsEngine.setSettings(this.state.graphic)
  }

  onCustomDrawDistanceChange(e: InputEvent) {
    const srcElement = e.currentTarget as HTMLInputElement
    const graphic = this.state.graphic
    graphic.customDrawDistance = parseInt(srcElement.value, 10)
    this.setState({ graphic })
    this.sendGraphicsSettings()
  }

  onCustomWaterQualityChange(e: InputEvent) {
    const srcElement = e.currentTarget as HTMLInputElement
    const graphic = this.state.graphic
    graphic.customWaterQuality = srcElement.value as 'simple' | 'reflection'
    this.setState({ graphic })
    this.sendGraphicsSettings()
  }

  onCustomGlowEffectsChange(inputElement: HTMLInputElement) {
    const graphic = this.state.graphic
    graphic.customGlowEffects = inputElement.checked
    this.setState({ graphic })
    this.sendGraphicsSettings()
  }

  onCustomAntiAliasingChange(e: InputEvent) {
    const srcElement = e.currentTarget as HTMLInputElement
    const graphic = this.state.graphic
    graphic.customAntiAliasing = parseInt(srcElement.value, 10)
    this.setState({ graphic })
    this.sendGraphicsSettings()
  }

  onCustomMaxActiveParcelsChange(e: InputEvent) {
    const srcElement = e.currentTarget as HTMLInputElement
    const graphic = this.state.graphic
    graphic.customMaxActiveParcels = parseInt(srcElement.value, 10)
    this.setState({ graphic })
    this.sendGraphicsSettings()
  }

  onCustomFogChange(inputElement: HTMLInputElement) {
    const graphic = this.state.graphic
    graphic.customFog = inputElement.checked
    this.setState({ graphic })
    this.sendGraphicsSettings()
  }

  render() {
    const isCustomGraphics = this.state.graphic.level === GraphicLevels.Custom

    return (
      <section class="settings">
        <header>
          <h2>Settings</h2>
        </header>

        <section>
          <h3>general</h3>
          <dl class="props">
            <dt>Field of view</dt>
            <dd>
              <label>
                <input type="radio" name="fov" value={NORMAL_FOV} checked={this.state.fov === NORMAL_FOV} onChange={this.onFOVChange.bind(this) as any} />
                Normal
              </label>
              <label>
                <input type="radio" name="fov" value={WIDE_FOV} checked={this.state.fov === WIDE_FOV} onChange={this.onFOVChange.bind(this) as any} />
                Wide
              </label>
            </dd>

            {!isMobile() && (
              <>
                <dt>Mouse sensitivity: {Math.round(this.state.mouseSensitivityPercentage)}</dt>
                <dd>
                  <input list="sensitivity-markers" type="range" step={1} max={100} min={1} value={this.state.mouseSensitivityPercentage} onInput={this.onSensitivityChange.bind(this) as any} />
                  <datalist id="sensitivity-markers">
                    <option value={Math.round(toReversedPercentage(DEFAULT_SENSITIVITY, MIN_SENSITIVITY, MAX_SENSITIVITY))}>default</option>
                  </datalist>
                </dd>
              </>
            )}

            {this.state.showMinimapSettings && (
              <>
                <dt>Enable mini map</dt>
                <dd>
                  <input type="checkbox" onChange={(e) => this.onToggleMinimap(e.target as HTMLInputElement)} checked={!!this.state.minimap?.enabled} />
                </dd>
              </>
            )}
            {this.state.showMinimapSettings && !!this.state.minimap?.enabled && (
              <>
                <dt>Zoom out mini map</dt>
                <dd>
                  <input type="checkbox" onChange={(e) => this.onToggleMinimapZoom(e.target as HTMLInputElement)} checked={!!this.state.minimap?.zoomed} />
                </dd>
              </>
            )}
            {this.state.showMinimapSettings && !!this.state.minimap?.enabled && (
              <>
                <dt>Rotate mini map</dt>
                <dd>
                  <input type="checkbox" onChange={(e) => this.onToggleMinimapRotate(e.target as HTMLInputElement)} checked={!!this.state.minimap?.rotate} />
                </dd>
              </>
            )}

            <dt>Show chat</dt>
            <dd>
              <input type="checkbox" onChange={(e) => this.onToggleChat(e.target as HTMLInputElement)} checked={chatSettings.enabled} />
            </dd>
          </dl>
        </section>

        <section>
          <h3>audio</h3>
          <dl class="props">
            <VolumeControl settingsUI={this} channel="parcelAudioVolume" label="Parcel audio" />
            <VolumeControl settingsUI={this} channel="soundEffectsVolume" label="Sound effects" />
            <VolumeControl settingsUI={this} channel="musicVolume" label="Radio" />
          </dl>
        </section>

        <section>
          <h3>voice chat</h3>
          <dl class="props">
            <dt>Enable voice chat</dt>
            <dd>
              <input type="checkbox" onChange={(e) => this.onToggleVoice(e.target as HTMLInputElement)} checked={this.state.voiceEnabled} />
            </dd>

            {this.state.voiceEnabled && (
              <>
                <dt>Microphone</dt>
                <dd>
                  <select value={this.state.voiceDeviceId} onChange={this.onVoiceDeviceChange.bind(this) as any}>
                    {this.state.voiceInputDevices.map((d) => (
                      <option value={d.deviceId}>{d.label}</option>
                    ))}
                  </select>
                </dd>

                <dt>
                  Pitch: {this.state.voicePitch > 0 ? '+' : ''}
                  {Math.round(this.state.voicePitch)}
                </dt>
                <dd>
                  <input type="range" min={-12} max={12} step={1} value={this.state.voicePitch} onInput={this.onVoicePitchChange.bind(this) as any} />
                </dd>
                <dd class="full">
                  <small>Slide down for a deeper voice, up for higher.</small>
                </dd>

                <dt>Monitor yourself</dt>
                <dd>
                  <input type="checkbox" onChange={(e) => this.onToggleVoiceMonitor(e.target as HTMLInputElement)} checked={this.state.voiceMonitor} />
                </dd>
              </>
            )}
          </dl>
        </section>

        <section>
          <h3>gfx</h3>
          <dl class="props">
            {!isMobile() && (
              <>
                <dt>Quality</dt>
                <dd>
                  <select value={this.state.graphic.level} onChange={this.onGraphicLevelChange.bind(this) as any}>
                    <option value={GraphicLevels.Low}>Low</option>
                    <option value={GraphicLevels.Medium}>Medium</option>
                    <option value={GraphicLevels.High}>High</option>
                    <option value={GraphicLevels.Ultra}>Ultra</option>
                    <option value={GraphicLevels.Custom}>Custom</option>
                  </select>
                </dd>
              </>
            )}

            <dt>Realistic lighting</dt>
            <dd>
              <input type="checkbox" checked={this.state.realisticLighting} onChange={(e) => this.onRealisticLightingChange(e.target as HTMLInputElement)} />
            </dd>

            {isCustomGraphics && !isMobile() && (
              <>
                <dt>Draw distance: {this.state.graphic.customDrawDistance || 128}</dt>
                <dd>
                  <input type="range" min={32} max={512} step={16} value={this.state.graphic.customDrawDistance || 128} onInput={this.onCustomDrawDistanceChange.bind(this) as any} />
                </dd>
                <dd class="full">
                  <small>Controls both view distance and parcel loading distance.</small>
                </dd>

                <dt>Max active parcels: {this.state.graphic.customMaxActiveParcels || 11}</dt>
                <dd>
                  <input type="range" min={3} max={50} step={1} value={this.state.graphic.customMaxActiveParcels || 11} onInput={this.onCustomMaxActiveParcelsChange.bind(this) as any} />
                </dd>
                <dd class="full">
                  <small>Maximum number of parcels that can be active at once. Lower values improve FPS.</small>
                </dd>

                <dt>Water quality</dt>
                <dd>
                  <label>
                    <input type="radio" name="water-quality" value="simple" checked={this.state.graphic.customWaterQuality === 'simple'} onChange={this.onCustomWaterQualityChange.bind(this) as any} />
                    Low
                  </label>
                  <label>
                    <input type="radio" name="water-quality" value="reflection" checked={this.state.graphic.customWaterQuality === 'reflection'} onChange={this.onCustomWaterQualityChange.bind(this) as any} />
                    High
                  </label>
                </dd>

                <dt>Glow effects</dt>
                <dd>
                  <input type="checkbox" checked={this.state.graphic.customGlowEffects !== false} onChange={(e) => this.onCustomGlowEffectsChange(e.target as HTMLInputElement)} />
                </dd>

                <dt>Fog</dt>
                <dd>
                  <input type="checkbox" checked={this.state.graphic.customFog !== false} onChange={(e) => this.onCustomFogChange(e.target as HTMLInputElement)} />
                </dd>

                <dt>Anti-aliasing: {this.state.graphic.customAntiAliasing ?? 2}</dt>
                <dd>
                  <input type="range" min={0} max={8} step={2} value={this.state.graphic.customAntiAliasing ?? 2} onInput={this.onCustomAntiAliasingChange.bind(this) as any} />
                </dd>
              </>
            )}
          </dl>
        </section>
      </section>
    )
  }
}

function VolumeControl({ channel, settingsUI, label, minVolume, maxVolume }: { channel: AudioChannel; settingsUI: SettingsUI; label: string; minVolume?: number | undefined; maxVolume?: number | undefined }) {
  if (!settingsUI.state.audio) return null

  const min = minVolume ?? -30
  const max = maxVolume ?? 12
  const snapThreshold = 1
  const defaultValue = 0
  const stateValue = settingsUI.state.audio[channel]
  const value = stateValue > 0 ? gainToDecibels(stateValue) : min

  const onInput = (e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    if (!(e.target instanceof HTMLInputElement)) return
    let parsedValue = parseFloat(e.target.value)
    if (parsedValue > -snapThreshold && parsedValue < snapThreshold) {
      parsedValue = defaultValue
    }
    const newValue = parsedValue > min ? decibelsToGain(parsedValue) : 0
    settingsUI.onVolumeChange(channel, newValue)
  }

  const onDoubleClick = (_e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    settingsUI.onVolumeChange(channel, 1)
  }

  const percentage = value <= min ? 0 : Math.round(((value - min) / (max - min)) * 100)
  const display = value <= min ? `${label} (muted)` : `${label}: ${percentage}%`

  return (
    <>
      <dt>{display}</dt>
      <dd>
        <input type="range" step={0.25} {...{ onInput, onDoubleClick, min, max, value }} />
      </dd>
    </>
  )
}

function gainToDecibels(value: number) {
  return 20 * (Math.LOG10E * Math.log(value))
}

function decibelsToGain(value: number) {
  return Math.exp(value / (Math.LOG10E * 20))
}
