import { Component, JSX } from 'preact'
import { isMobile } from '../../common/helpers/detector'
import { AudioSettings } from '../audio/audio-engine'
import Connector from '../connector'
import { FOV, NORMAL_FOV, WIDE_FOV } from '../graphic/field-of-view'
import { type GraphicEngine, GraphicLevels, GraphicSettings } from '../graphic/graphic-engine'
import ParcelScript from '../parcel-script'
import type { MinimapSettings } from '../minimap'
import { chatSettings } from './interact/chat'
import { DEFAULT_SENSITIVITY, MAX_SENSITIVITY, MIN_SENSITIVITY } from '../controls/user-control-settings'

function toReversedPercentage(value: number, min: number, max: number): number {
  return ((max - value) / (max - min)) * 100
}

function fromReversedPercentage(percentage: number, min: number, max: number): number {
  return max - (percentage / 100) * (max - min)
}

type AudioChannel = keyof AudioSettings

type Props = {
  scene: BABYLON.Scene
  minimapSettings: MinimapSettings
}

type SettingsCategory = 'general' | 'audio' | 'graphics'

interface State {
  audio: AudioSettings | undefined
  graphic: GraphicSettings
  fov: number
  minimap: MinimapSettings
  showMinimapSettings: boolean
  mouseSensitivityPercentage: number
  activeCategory: SettingsCategory
}

export class SettingsUI extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      audio: this.audioEngine?.getSettings(),
      graphic: this.graphicsEngine.getSettings(),
      fov: this.fov.value,
      minimap: this.minimap,
      showMinimapSettings: !window.config.isSpace,
      // we reverse the value as higher values are lower sensitivities
      mouseSensitivityPercentage: toReversedPercentage(this.cameraSettings.angularSensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY),
      activeCategory: 'general',
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
    if (this.audioEngine && this.state.audio) {
      this.audioEngine.setSettings(this.state.audio)
    }
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

  onCategoryChange(category: SettingsCategory) {
    this.setState({ activeCategory: category })
  }

  render() {
    const { activeCategory } = this.state
    const isCustomGraphics = this.state.graphic.level === GraphicLevels.Custom

    return (
      <section class="settings">
        <header>
          <h2>Settings</h2>
        </header>

        <ul class="inline-tabs">
          <li className={`settings-tab ${activeCategory === 'general' ? '-active' : ''}`} onClick={() => this.onCategoryChange('general')}>
            General
          </li>
          <li className={`settings-tab ${activeCategory === 'audio' ? '-active' : ''}`} onClick={() => this.onCategoryChange('audio')}>
            Audio
          </li>
          <li className={`settings-tab ${activeCategory === 'graphics' ? '-active' : ''}`} onClick={() => this.onCategoryChange('graphics')}>
            Graphics
          </li>
        </ul>

        <div className="settings-content">
          {activeCategory === 'general' && (
            <div className="settings-panel">
              <div className="fs">
                <label>Field of view</label>
                <div>
                  <label>
                    <input type="radio" name="fov" value={NORMAL_FOV} checked={this.state.fov === NORMAL_FOV} onChange={this.onFOVChange.bind(this) as any} />
                    Normal FOV
                  </label>
                  <label>
                    <input type="radio" name="fov" value={WIDE_FOV} checked={this.state.fov === WIDE_FOV} onChange={this.onFOVChange.bind(this) as any} />
                    Wide FOV
                  </label>
                </div>
              </div>
              {!isMobile() && (
                <div className="fs">
                  <label>Mouse sensitivity: {Math.round(this.state.mouseSensitivityPercentage)}</label>
                  <input list="sensitivity-markers" type="range" step={1} max={100} min={1} value={this.state.mouseSensitivityPercentage} onInput={this.onSensitivityChange.bind(this) as any} />
                  <datalist id="sensitivity-markers">
                    <option value={Math.round(toReversedPercentage(DEFAULT_SENSITIVITY, MIN_SENSITIVITY, MAX_SENSITIVITY))}>default</option>
                  </datalist>
                </div>
              )}
              {this.state.showMinimapSettings && (
                <div className="fs checkbox">
                  <label>
                    <input type="checkbox" onChange={(e) => this.onToggleMinimap(e.target as HTMLInputElement)} checked={!!this.state.minimap?.enabled} />
                    Enable mini map
                  </label>
                </div>
              )}
              {this.state.showMinimapSettings && !!this.state.minimap?.enabled && (
                <div className="fs checkbox">
                  <label>
                    <input type="checkbox" onChange={(e) => this.onToggleMinimapZoom(e.target as HTMLInputElement)} checked={!!this.state.minimap?.zoomed} />
                    Zoom out mini map
                  </label>
                </div>
              )}
              {this.state.showMinimapSettings && !!this.state.minimap?.enabled && (
                <div className="fs checkbox">
                  <label>
                    <input type="checkbox" onChange={(e) => this.onToggleMinimapRotate(e.target as HTMLInputElement)} checked={!!this.state.minimap?.rotate} />
                    Rotate mini map
                  </label>
                </div>
              )}
              <div className="fs checkbox">
                <label>
                  <input type="checkbox" onChange={(e) => this.onToggleChat(e.target as HTMLInputElement)} checked={chatSettings.enabled} />
                  Show chat
                </label>
              </div>
            </div>
          )}

          {activeCategory === 'audio' && (
            <div className="settings-panel">
              <div className="fs">
                <VolumeControl settingsUI={this} channel="parcelAudioVolume" label="Parcel Audio" />
              </div>
              <div className="fs">
                <VolumeControl settingsUI={this} channel="soundEffectsVolume" label="Sound Effects" />
              </div>
              <div className="fs">
                <VolumeControl settingsUI={this} channel="musicVolume" label="Ambience" />
              </div>
            </div>
          )}

          {activeCategory === 'graphics' && (
            <div className="settings-panel">
              {!isMobile() && (
                <div className="fs dropdown">
                  <label>
                    <select value={this.state.graphic.level} onChange={this.onGraphicLevelChange.bind(this) as any}>
                      <option value={GraphicLevels.Low}>Low graphics</option>
                      <option value={GraphicLevels.Medium}>Medium graphics</option>
                      <option value={GraphicLevels.High}>High graphics</option>
                      <option value={GraphicLevels.Ultra}>Ultra graphics</option>
                      <option value={GraphicLevels.Custom}>Custom</option>
                    </select>
                  </label>
                </div>
              )}
              {isCustomGraphics && !isMobile() && (
                <>
                  <div className="fs">
                    <label>Draw distance: {this.state.graphic.customDrawDistance || 128}</label>
                    <input type="range" min={32} max={512} step={16} value={this.state.graphic.customDrawDistance || 128} onInput={this.onCustomDrawDistanceChange.bind(this) as any} />
                    <small style="opacity: 0.7; display: block; margin-top: 4px;">Controls both view distance and parcel loading distance.</small>
                  </div>
                  <div className="fs">
                    <label>Max active parcels: {this.state.graphic.customMaxActiveParcels || 11}</label>
                    <input type="range" min={3} max={50} step={1} value={this.state.graphic.customMaxActiveParcels || 11} onInput={this.onCustomMaxActiveParcelsChange.bind(this) as any} />
                    <small style="opacity: 0.7; display: block; margin-top: 4px;">Maximum number of parcels that can be active at once. Lower values improve FPS.</small>
                  </div>
                  <div className="fs">
                    <label>Water quality</label>
                    <div>
                      <label>
                        <input type="radio" name="water-quality" value="simple" checked={this.state.graphic.customWaterQuality === 'simple'} onChange={this.onCustomWaterQualityChange.bind(this) as any} />
                        Low
                      </label>
                      <label>
                        <input type="radio" name="water-quality" value="reflection" checked={this.state.graphic.customWaterQuality === 'reflection'} onChange={this.onCustomWaterQualityChange.bind(this) as any} />
                        High
                      </label>
                    </div>
                  </div>
                  <div className="fs checkbox">
                    <label>
                      <input type="checkbox" checked={this.state.graphic.customGlowEffects !== false} onChange={(e) => this.onCustomGlowEffectsChange(e.target as HTMLInputElement)} />
                      Glow effects
                    </label>
                  </div>
                  <div className="fs checkbox">
                    <label>
                      <input type="checkbox" checked={this.state.graphic.customFog !== false} onChange={(e) => this.onCustomFogChange(e.target as HTMLInputElement)} />
                      Fog
                    </label>
                  </div>
                  <div className="fs">
                    <label>Anti-aliasing samples: {this.state.graphic.customAntiAliasing ?? 2}</label>
                    <input type="range" min={0} max={8} step={2} value={this.state.graphic.customAntiAliasing ?? 2} onInput={this.onCustomAntiAliasingChange.bind(this) as any} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
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
  const displayValue = value <= min ? `${label}: Muted` : `${label}: ${percentage}%`

  return (
    <>
      <label>{displayValue}</label>
      <input type="range" step={0.25} {...{ onInput, onDoubleClick, min, max, value }} />
    </>
  )
}

function gainToDecibels(value: number) {
  return 20 * (Math.LOG10E * Math.log(value))
}

function decibelsToGain(value: number) {
  return Math.exp(value / (Math.LOG10E * 20))
}
