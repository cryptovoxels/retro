import { Component, render } from 'preact'
import { AudioMeter, createAudioMeter } from '../components/audio-meter'
import { exitPointerLock, requestPointerLockIfNoOverlays } from '../../common/helpers/ui-helpers'
import Boombox from '../features/boombox'
import { AudioBroadcaster } from '../components/audio-broadcaster'
import Connector from '../connector'
import { unmountComponentAtNode, useEffect, useState } from 'preact/compat'

const DEFAULT_AUDIO_DEVICE = { label: 'Default', deviceId: 'default' }

export enum BroadcastStatus {
  offline,
  connecting,
  live,
  stopped,
  error,
}

interface Props {
  boombox: Boombox
  onClose: () => void
}

interface State {
  inputDevice: string
  status: BroadcastStatus
  broadcaster: string
  monitor: boolean
  inputDevices: InputDevice[]
  canBroadcast: boolean
}

interface InputDevice {
  label: string
  deviceId: string
  kind?: string
}

export class BoomboxBroadcast extends Component<Props, State> {
  audioBroadcaster: AudioBroadcaster | null = null
  source: GainNode
  stream: MediaStream | null = null
  streamNode: MediaStreamAudioSourceNode | null = null
  monitor: GainNode
  audioMeter: AudioMeter

  onDeviceChange: () => void

  constructor(props: Props) {
    super()

    this.onDeviceChange = () => this.refreshInputDevices()
    this.state = {
      broadcaster: null!,
      status: BroadcastStatus.offline,
      monitor: false,
      inputDevice: 'default',
      inputDevices: [DEFAULT_AUDIO_DEVICE],
      canBroadcast: props.boombox.canBroadcast,
    }

    const audioContext = this.audioContext
    if (!audioContext) {
      throw new Error('Audio context not available')
    }

    this.audioMeter = createAudioMeter(audioContext)
    this.source = audioContext.createGain()

    this.monitor = audioContext.createGain()
    this.monitor.gain.value = 0 // don't deafen our users by default

    // connect it all up
    this.source.connect(this.audioMeter)
    this.source.connect(this.monitor)
    this.monitor.connect(audioContext.destination)

    this.setInputDevice('default')
  }

  get supportsDesktopCapture() {
    return !!navigator.mediaDevices['getDisplayMedia']
  }

  get parcel() {
    return this.boombox?.parcel
  }

  get boombox() {
    return this.props.boombox
  }

  get connector(): Connector {
    return window.connector
  }

  get audioContext(): AudioContext | null {
    return (undefined as any /* todo(lite): BABYLON.Engine.audioEngine?.audioContext */) ?? null
  }

  setMonitor(value: boolean) {
    this.setState({ monitor: value })
    this.monitor.gain.value = value ? 1 : 0
  }

  setInputDevice(deviceId: string) {
    const lastInputDevice = this.state.inputDevice
    this.setState({ inputDevice: deviceId })
    if (deviceId === 'desktop' && navigator.mediaDevices['getDisplayMedia']) {
      navigator.mediaDevices['getDisplayMedia']({
        audio: {
          channelCount: { ideal: 2 },
          echoCancellation: { ideal: false },
        },
        video: {
          ideal: false,
        } as any,
      })
        .then((result) => {
          if (result.getAudioTracks().length === 0 || !this.audioContext) {
            this.setState({ inputDevice: lastInputDevice })
            alert('No audio stream available. Please be sure to enable "Share Audio". This feature is not available in the current Firefox release.')
            return
          }
          this.stopInput()
          this.stream = result
          this.streamNode = this.audioContext.createMediaStreamSource(this.stream)
          this.streamNode.connect(this.source)
        })
        .catch(() => {
          alert('Due to browser limitations, screen sharing permission must be granted in order to share desktop / tab audio. You must tick the "Share Audio" option. This feature is not available in the current Firefox release.')
          this.setState({ inputDevice: lastInputDevice })
        })
    } else {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: { ideal: false }, // #UseHeadphonesDammit #VcHygiene
      }
      if (deviceId && deviceId !== 'default') {
        audioConstraints.deviceId = deviceId
      }
      navigator.mediaDevices
        .getUserMedia({ audio: audioConstraints })
        .then((result) => {
          if (!this.audioContext) {
            this.setState({ inputDevice: lastInputDevice })
            alert('No audio context available. Please try again.')
            return
          }
          this.stopInput()
          this.stream = result
          this.streamNode = this.audioContext.createMediaStreamSource(this.stream)
          this.streamNode.connect(this.source)
        })
        .catch((err) => {
          console.error(err)
          this.setState({ inputDevice: lastInputDevice })
        })
    }
  }

  componentDidMount() {
    if (this.boombox.broadcastingAvatar) {
      this.setState({ broadcaster: this.boombox.broadcastingAvatar.name || 'Someone' })
    }

    this.boombox.onAvatarChangeObservable.add((avatar) => {
      if (avatar) {
        this.setState({ broadcaster: avatar.name || 'Someone' })
      } else {
        this.setState({ broadcaster: null! })
      }
    })

    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange)
    this.refreshInputDevices()
  }

  componentWillUnmount() {
    navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange)
    this.stopInput()
  }

  refreshInputDevices() {
    if (navigator.mediaDevices.enumerateDevices) {
      return navigator.mediaDevices.enumerateDevices().then((result: InputDevice[]) => {
        let hasCurrentDevice = false
        let hasLabels = false
        const inputDevices = result.filter((d) => {
          if (d.kind === 'audioinput') {
            if (d.deviceId === this.state.inputDevice) hasCurrentDevice = true
            if (d.label) hasLabels = true
            return true
          }
        })

        if (hasLabels) {
          this.setState({ inputDevices })

          // if the user has removed their input device, let's update it
          if (!hasCurrentDevice) {
            this.setInputDevice(inputDevices[0].deviceId)
          }
        } else {
          // they haven't given us permission to use the microphone (or "Always Allow" not selected in firefox)
          this.setState({ inputDevices: [DEFAULT_AUDIO_DEVICE] })
        }
      })
    }
  }

  setStatus(status: BroadcastStatus) {
    this.setState({ status })
  }

  close() {
    this.stopBroadcast()
    this.props.onClose()
  }

  async startBroadcast() {
    this.setStatus(BroadcastStatus.connecting)

    this.audioBroadcaster = new AudioBroadcaster(this.source, (err) => {
      // an error occurred after the broadcast started
      console.error(err)
      this.setStatus(BroadcastStatus.stopped)
      this.boombox.stopEmit()
    })

    // this.setSharedState({broadcastId: 'TEST-123'})
    try {
      const { id } = await this.audioBroadcaster.start()
      // TODO: add security around who can broadcast and verify that this avatar actually is the one broadcasting
      this.boombox.sendState({ broadcastId: id, avatarId: this.connector.persona.uuid })
      this.setStatus(BroadcastStatus.live)
      this.boombox.emitParticles('🔊')
    } catch (startErr) {
      // an error occurred BEFORE the broadcast started (before updating shared state)
      console.error(startErr)
      this.setStatus(BroadcastStatus.error)
    }
  }

  stopBroadcast() {
    if (this.audioBroadcaster) {
      this.audioBroadcaster.stop()
      this.setStatus(BroadcastStatus.offline)
      this.audioBroadcaster = null!
      this.boombox.stopEmit()
      if (this.boombox.sharedState?.avatarId === this.connector.persona.uuid) {
        // clear out the broadcast for the next person!
        this.boombox.sendState({ broadcastId: null, avatarId: null })
      }
    }
  }

  stopInput() {
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop())
    if (this.streamNode) this.streamNode.disconnect()
    this.stream = null!
    this.streamNode = null!
  }

  render() {
    return this.state.canBroadcast ? (
      <div className="overlay boombox-broadcast">
        <button className="close" onClick={() => this.close()}>
          &times;
        </button>

        <h3>
          <img src="/images/audio.png" /> Boombox Broadcast
        </h3>

        <p>
          Broadcast audio to <strong>{this.parcel.name || this.parcel.address}</strong>
        </p>

        <p>
          <label>
            Input Device <br />
            <select value={this.state.inputDevice} style={{ width: '100%' }} onChange={(e) => this.setInputDevice(e.currentTarget['value'])}>
              {this.state.inputDevices.map((d) => (
                <option value={d.deviceId}>{d.label}</option>
              ))}
              {this.supportsDesktopCapture && <option value="desktop">Desktop / Tab Audio Capture</option>}
            </select>
          </label>
        </p>

        {this.state.inputDevice === 'desktop' && (
          <p>
            <div class="broadcast-info">
              <strong>To share tab audio, select "Tab" option and enable "Share audio" option.</strong>
              <br /> Your screen will not be shared, only audio, however due to browser limitations, screen sharing permission must be granted.
            </div>
          </p>
        )}

        <p>
          <AudioMeterComponent audioMeter={this.audioMeter} />
        </p>

        <p>
          <label>
            <input checked={this.state.monitor} onChange={(e) => this.setMonitor(e.currentTarget['checked'])} type="checkbox" /> Monitor Audio (headphones recommended)
          </label>
        </p>

        <ShowStatus broadcaster={this.state.broadcaster} status={this.state.status} />

        <div className="fs">
          <ActionButtons status={this.state.status} close={this.close.bind(this)} startBroadcast={this.startBroadcast.bind(this)} />
        </div>
      </div>
    ) : (
      <div className="overlay boombox-broadcast">
        <button className="close" onClick={() => this.close()}>
          &times;
        </button>

        <h3>
          <img src="/images/audio.png" /> Boombox Broadcast
        </h3>

        <p>
          Broadcasted audio at <strong>{this.parcel.name || this.parcel.address}</strong>
        </p>
        <div class="broadcast-warning">{this.state.broadcaster ? <strong>{this.state.broadcaster} is currently broadcasting</strong> : <strong>Broadcast offline</strong>}</div>
      </div>
    )
  }
}

function toPercent(value: number) {
  return Math.round(value * 1000) / 10 + '%'
}

function ShowStatus(props: { broadcaster: string; status: BroadcastStatus }) {
  if (props.broadcaster) {
    return (
      <div class="broadcast-warning">
        <strong>{props.broadcaster} is currently broadcasting</strong> <br />
        This will stop their broadcast and replace with your stream
      </div>
    )
  }

  if (props.status === BroadcastStatus.error) {
    return (
      <div class="broadcast-error">
        <strong>Cannot start broadcast due to an unknown error</strong> <br />
        Please try again!
      </div>
    )
  }

  if (props.status === BroadcastStatus.stopped) {
    return (
      <div class="broadcast-error">
        <strong>Broadcast has stopped due to an error</strong> <br />
        Please try again!
      </div>
    )
  }

  if (props.status === BroadcastStatus.live) {
    return <div class="broadcast-status">You are live!</div>
  }

  return null
}

function ActionButtons(props: { status: BroadcastStatus; close: () => void; startBroadcast: () => void }) {
  if (props.status === BroadcastStatus.connecting) {
    return <button disabled>Connecting...</button>
  }

  if (props.status === BroadcastStatus.live) {
    return (
      <button class="end-broadcast" onClick={() => props.close()}>
        End Broadcast
      </button>
    )
  }

  return (
    <button class="start-broadcast" onClick={() => props.startBroadcast()}>
      Start Broadcasting
    </button>
  )
}

function AudioMeterComponent(props: { audioMeter: AudioMeter }) {
  const audioMeter = props.audioMeter
  const [audioLevel, setAudioLevel] = useState<{
    l: number
    r: number
    clipping: boolean
  }>({ l: 0, r: 0, clipping: false })

  useEffect(() => {
    return audioMeter.watch((l, r, clipping) => {
      setAudioLevel({ l, r, clipping })
    })
  }, [])

  return (
    <div class={audioLevel.clipping ? 'audio-meter clipping' : 'audio-meter'}>
      <span class="audio-meter--l" style={{ width: toPercent(audioLevel.l) }}></span>
      <span class="audio-meter--r" style={{ width: toPercent(audioLevel.r) }}></span>
    </div>
  )
}

export function openBoomboxBroadcastUI(boombox: Boombox, onClose: () => void): Promise<BoomboxBroadcast> {
  return new Promise((resolve) => {
    const div = document.createElement('div')
    document.body.appendChild(div)

    render(
      <BoomboxBroadcast
        onClose={() => {
          if (!div.parentElement) return
          unmountComponentAtNode(div)
          div.remove()
          requestPointerLockIfNoOverlays()
          onClose && onClose()
        }}
        boombox={boombox}
        ref={resolve}
      />,
      div,
    )

    exitPointerLock()
  })
}
