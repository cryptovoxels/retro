import { Component } from 'preact'
import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { uploadMedia } from '../../common/helpers/upload-media'
import { writeCaip19 } from '../../common/helpers/nft-url'
import type { AvatarRef } from '../../common/messages/avatar-ref'
import { PanelType } from '../../web/src/components/panel'
import { track } from '../../web/src/helpers/umami'
import { app } from '../../web/src/state'
import { wompFlash } from '../graphic/womp-flash'
import { MinimapSettings } from '../minimap'
import type Parcel from '../parcel'
import type NftImage from '../features/nft-image'
import { pendingWomp, sidebarClosed, uiAsideTick, uiPane, type WompMetadata } from '../store'
import { resolveUgc } from '../utils/helpers'
import { cameraPosition } from '../utils/camera'
import { readNftUrl } from '../utils/proxy'
import { WompMetadata as WompMetadataView } from '../../web/src/components/womp-metadata'

interface Props {
  onClose?: () => void
  coords: string
  parcel: Parcel
  image: string
  metadata: WompMetadata
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
const ART_DISTANCE_M = 5

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

function pointInFrustum(point: BABYLON.Vector3, planes: BABYLON.Plane[]): boolean {
  for (const p of planes) {
    if (p.dotCoordinate(point) < 0) return false
  }
  return true
}

function screenXY(world: BABYLON.Vector3, scene: BABYLON.Scene): { x: number; y: number } | null {
  const camera = scene.activeCamera
  if (!camera) return null
  const engine = scene.getEngine()
  const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
  const transform = scene.getTransformMatrix()
  const scr = BABYLON.Vector3.Project(world, BABYLON.Matrix.Identity(), transform, viewport)
  if (scr.z < 0 || scr.z > 1) return null
  const x = (scr.x - viewport.x) / viewport.width
  const y = (scr.y - viewport.y) / viewport.height
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }
}

function avatarRef(a: any): AvatarRef {
  // local player: use the loaded profile AvatarRef, not the wire identity wallet
  if (a.isUser) {
    if (app.avatarRef && typeof app.avatarRef === 'object') return app.avatarRef
    if (app.state.name && app.state.wallet) return { id: app.state.wallet, name: app.state.name, owner: app.state.wallet, created_at: '' }
    if (app.state.name) return app.state.name
    if (app.state.wallet) return app.state.wallet
  }
  const name = a.description?.name
  const owner = a.wallet
  if (name && owner) return { id: owner, name, owner, created_at: '' }
  if (name) return name
  if (owner) return owner
  return 'anon'
}

function collectMetadata(scene: BABYLON.Scene): WompMetadata {
  const camera = scene.activeCamera
  if (!camera) return { avatars: [], art: [] }

  const planes = BABYLON.Frustum.GetPlanes(camera.getTransformationMatrix())
  const camPos = cameraPosition(scene)
  const avatars: WompMetadata['avatars'] = []
  const art: WompMetadata['art'] = []

  const seen = new Set<string>()
  const list = [...(window.connector?.avatars ?? [])]
  const self = window.connector?.persona?.avatar
  if (self && !list.includes(self)) list.push(self)

  for (const a of list) {
    if (!a?.hasPosition || seen.has(a.uuid)) continue
    seen.add(a.uuid)
    const pos = a.absolutePosition
    if (!pointInFrustum(pos, planes)) continue
    const xy = screenXY(pos, scene)
    if (!xy) continue
    avatars.push({ avatar: avatarRef(a), x: xy.x, y: xy.y })
  }

  const parcels = window.grid?.parcels
  if (parcels) {
    for (const parcel of parcels.values()) {
      for (const f of parcel.getFeaturesByType('nft-image') as NftImage[]) {
        if (!f) continue
        const pos = f.absolutePosition
        if (!pos) continue
        const dist = BABYLON.Vector3.Distance(camPos, pos)
        if (dist > ART_DISTANCE_M) continue
        if (!pointInFrustum(pos, planes)) continue
        if (!f.url) continue
        const info = readNftUrl(f.url)
        if (!info) continue
        const schema = (f.asset?.asset_contract?.schema_name || 'ERC721').toLowerCase() === 'erc1155' ? 'erc1155' : 'erc721'
        const xy = screenXY(pos, scene)
        if (!xy) continue
        art.push({
          name: f.asset?.name ?? null,
          x: xy.x,
          y: xy.y,
          src: writeCaip19(info, schema),
        })
      }
    }
  }

  return { avatars, art }
}

export default class TakeWomp extends Component<Props, State> {
  constructor(props: Props) {
    super(props)

    this.state = {
      content: '',
      uploading: false,
      kind: WompType.Broadcast,
    }
  }

  componentDidMount() {
    setTimeout(() => (document.querySelector('.take-womp textarea') as HTMLTextAreaElement | null)?.focus(), 0)
    this.fetchDescription()
  }

  async fetchDescription() {
    try {
      const r = await fetch('/api/models/womp-description', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          metadata: this.props.metadata,
          coords: this.props.coords,
          parcel_id: this.props.parcel.id,
        }),
      }).then((r) => r.json())
      if (r?.description && !this.state.content) {
        this.setState({ content: String(r.description).slice(0, 160) })
      }
    } catch {
      // fail soft — leave blank
    }
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

    // wall-eligible only when standing on + looking at the same lot (strict look-at hit, not nearest)
    const standing = window.grid?.currentParcel()
    const looking = window.grid?.getLookAtParcel()
    const parcel = standing && looking && Number(standing.id) === Number(looking.id) ? standing : looking || standing || window.grid?.currentOrNearestParcel()
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
    let metadata: WompMetadata = { avatars: [], art: [] }
    try {
      metadata = collectMetadata(scene)
      image = await BABYLON.ScreenshotTools.CreateScreenshotAsync(engine, scene.activeCamera, WompSize, 'image/jpeg')
    } finally {
      canvas.style.width = currentCanvasSizeWidth
      canvas.style.height = currentCanvasSizeHeight
      engine.resize(true)
      minimapSettings.hide = false
    }

    wompFlash(scene)

    pendingWomp.value = { coords, parcel, image, metadata }
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

    const blob = await (await fetch(this.props.image)).blob()
    const imageFile = new File([blob], `womp_${Date.now()}.jpg`, { type: 'image/jpeg' })
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
      parcel_id: this.props.parcel.id,
      space_id: typeof this.props.parcel.id === 'string' ? this.props.parcel.id : undefined,
      image_url: resolveUgc(uploadResult.location),
      metadata: this.props.metadata,
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
            await this.postReport(resolveUgc(uploadResult.location)!)
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
          <WompMetadataView metadata={this.props.metadata} />

          <h4>Womp Type</h4>
          <form class="PermissionsRadioSelector">
            <div>
              <label>
                <input checked={this.state.kind === WompType.Broadcast} onClick={() => this.setKind(WompType.Broadcast)} name="type" type="radio" />
                <div>
                  <strong>Public Broadcast</strong>
                  <div class="info">Display on homepage, parcel pages and your profile and notify everyone in world</div>
                </div>
              </label>
            </div>
            <div>
              <label>
                <input checked={this.state.kind === WompType.ProfileOnly} onClick={() => this.setKind(WompType.ProfileOnly)} name="type" type="radio" />
                <div>
                  <strong>Profile Only</strong>
                  <div class="info">Displays on your profile and parcel page or share a link directly</div>
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
