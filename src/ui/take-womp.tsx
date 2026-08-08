import { Component } from 'preact'
import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { convertDataURItoJPGFile, uploadMedia } from '../../common/helpers/upload-media'
import { PanelType } from '../../web/src/components/panel'
import { track } from '../../web/src/helpers/umami'
import { app } from '../../web/src/state'
import { wompFlash } from '../graphic/womp-flash'
import { MinimapSettings } from '../minimap'
import type Parcel from '../parcel'
import { pendingWomp, sidebarClosed, uiAsideTick, uiPane } from '../store'

interface Props {
  onClose?: () => void
  coords: string
  parcel: Parcel
  image: string
  scene: BABYLON.Scene
}

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

enum WompType {
  Public = 'public',
  Broadcast = 'broadcast',
  ProfileOnly = 'profile',
  BugReport = 'report',
}

interface State {
  content: string
  kind: WompType
  uploading: boolean
}

const WompSize = { width: 1024, height: 1024 } as const

let wompSound: BABYLON.Sound | null = null

function playWompSound() {
  const audio = window._audio
  if (!audio) return
  if (!wompSound) {
    wompSound = audio.createSound({
      name: 'womp',
      url: `${process.env.SOUNDS_URL}/womp.mp3`,
      options: { loop: false, autoplay: false },
    })
  }
  wompSound.setVolume(0.2)
  wompSound.play()
}

export default class TakeWomp extends Component<Props, State> {
  constructor(props: Props) {
    super(props)

    this.state = {
      content: '',
      uploading: false,
      kind: !window.config.isSpace ? WompType.Broadcast : WompType.ProfileOnly,
    }
  }

  componentDidMount() {
    setTimeout(() => (document.querySelector('.take-womp textarea') as HTMLTextAreaElement | null)?.focus(), 0)
  }

  static async Capture(engine: BABYLON.Engine, scene: BABYLON.Scene, minimapSettings: MinimapSettings) {
    if (scene.activeCamera === null) {
      app.showSnackbar('Failed to capture womp. Could not get camera', PanelType.Danger)
      return
    }

    const coords = window.connector.controls.getCoords()
    if (!coords) {
      app.showSnackbar('Failed to capture womp. Could not get coordinates', PanelType.Danger)
      return
    }

    // look-at parcel (not nearest-underfoot): wall filters to coords on that same lot
    const parcel = window.grid?.getTargetParcel()
    if (!parcel) {
      app.showSnackbar('Failed to capture womp. No parcel found', PanelType.Danger)
      return
    }

    playWompSound()
    track('create_womp')

    minimapSettings.hide = true

    const canvas = engine.getRenderingCanvas()
    if (!canvas) {
      app.showSnackbar('Failed to capture womp. Could not get canvas', PanelType.Danger)
      return
    }

    const currentCanvasSizeWidth = canvas.style.width + ''
    const currentCanvasSizeHeight = canvas.style.height + ''

    canvas.style.width = WompSize.width + 'px'
    canvas.style.height = WompSize.height + 'px'

    engine.resize(true)

    let image: string
    try {
      image = await BABYLON.ScreenshotTools.CreateScreenshotAsync(engine, scene.activeCamera, WompSize, 'image/jpeg')
    } finally {
      canvas.style.width = currentCanvasSizeWidth
      canvas.style.height = currentCanvasSizeHeight
      engine.resize(true)
      minimapSettings.hide = false
    }

    wompFlash(scene)

    pendingWomp.value = { coords, parcel, image }
    uiPane.value = 'takeWomp'
    sidebarClosed.value = false
    uiAsideTick.value++
    exitPointerLock()
  }

  close = () => {
    this.props.onClose?.()
  }

  async post() {
    this.setState({ uploading: true })

    const imageFile = convertDataURItoJPGFile(this.props.image, `${'womp_' + Date.now() + '.jpg'}`)
    const uploadResult = await uploadMedia(imageFile, 'womps')

    if (!uploadResult.success) {
      this.setState({ uploading: false })
      app.showSnackbar('Could not upload womp', PanelType.Danger)
      return
    }

    const body = JSON.stringify({
      kind: this.state.kind,
      content: this.state.content,
      coords: this.props.coords,
      parcel_id: window.config.isSpace ? null : this.props.parcel.id,
      space_id: this.props.parcel.spaceId,
      image_url: uploadResult.location,
    })

    fetch('/api/womps/create', {
      credentials: 'include',
      headers,
      method: 'post',
      body,
    })
      .then((r) => r.json())
      .then(async (r) => {
        if (!r.success) {
          app.showSnackbar(r.message || 'Unable to submit womp, please try again', PanelType.Danger)
          this.setState({ uploading: false })
          if (r.closeUi) {
            this.close()
          }
          return
        }
        if (r.success) {
          if (this.state.kind === WompType.BugReport) {
            await this.postReport(uploadResult.location)
          }
        }
        this.setState({ uploading: false })
        this.close()
      })
  }

  async postReport(image_url: string) {
    this.setState({ uploading: true })

    const subtext = `Reported by ${app.state.name ? app.state.name + ', ' : ''} ${app.state.wallet}, at <https://www.voxels.com/play?coords=${this.props.coords}|${this.props.coords}> . Parcel ${this.props.parcel.id}`
    const imgUrl = image_url
    const payload = {}

    Object.assign(payload, { content: this.state.content, image: imgUrl, subtext: subtext })

    const body = JSON.stringify(payload)

    await fetch('/api/womps/send-report', {
      headers,
      method: 'post',
      body,
    })
  }

  confirmReport() {
    if (!app.signedIn) {
      alert('Only signed in users can send a bug report, please log in!')
      return
    }
    if (!this.props.image) {
      alert("Can't submit report, no picture was taken")
      return
    }
    this.post()
  }

  setKind(kind: WompType) {
    if (window.config.isSpace && (kind == WompType.Broadcast || kind == WompType.Public)) {
      app.showSnackbar(`Spaces don't allow Broadcast or Public womps`)
      return
    }
    this.setState({ kind })
  }

  render() {
    return (
      <section class="take-womp">
        <h2>new womp</h2>

        <img class="take-womp-preview" src={this.props.image} alt="" />

        <div class="WompOptions">
          <h4>{this.state.kind === WompType.BugReport ? 'Bug Report Details (required)' : 'Description (optional)'}</h4>
          <textarea value={this.state.content} onInput={(e) => this.setState({ content: (e as any).target['value'] })} />

          <h4>Womp Type</h4>
          <form class="PermissionsRadioSelector">
            <div>
              <label>
                <input checked={this.state.kind === WompType.Broadcast} onClick={() => this.setKind(WompType.Broadcast)} name="type" type="radio" disabled={window.config.isSpace} />
                <div>
                  <strong>Public Broadcast</strong>
                  <div class="info">Display on homepage, parcel pages and your profile and notify everyone in world</div>
                  {window.config.isSpace && <small>Not available in Spaces</small>}
                </div>
              </label>
            </div>
            <div>
              <label>
                <input checked={this.state.kind === WompType.ProfileOnly} onClick={() => this.setKind(WompType.ProfileOnly)} name="type" type="radio" />
                <div>
                  <strong>Profile Only</strong>
                  <div class="info">Displays on your profile and {!window.config.isSpace ? `parcel` : `space`} page or share a link directly</div>
                </div>
              </label>
            </div>
            <div>
              <label>
                <input checked={this.state.kind === WompType.BugReport} onClick={() => this.setKind(WompType.BugReport)} name="type" type="radio" />
                <div>
                  <strong>Bug Report</strong>
                  <div class="info">Found an issue? This will only be viewable by Voxels. Please include a description with steps to reproduce and expected behavior.</div>
                </div>
              </label>
            </div>

            <p>
              <b>Coordinates:</b>
              <br /> {this.props.coords}
            </p>
          </form>
        </div>

        <button class="TakeWompButton" disabled={this.state.uploading} onClick={() => (this.state.kind === WompType.BugReport ? this.confirmReport() : this.post())}>
          {this.state.uploading ? <span>Posting, please wait...</span> : <span>Post</span>}
        </button>
      </section>
    )
  }
}
