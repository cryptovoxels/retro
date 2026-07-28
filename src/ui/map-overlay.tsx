import { debounce } from 'lodash'
import { Component, createRef, render } from 'preact/compat'
import type { MapParcelRecord } from '../../common/messages/api-parcels'
import type { Event } from '../../common/messages/event'
import { mapEventMarkerPopup, mapParcelPopup, mapTeleportPopup } from '../../web/src/map-parcel-popup'
import { app, AppEvent } from '../../web/src/state'
import ParcelEvent from '../../web/src/helpers/event'
import { MapMarker, PAGE_ORTHO, VoxelsMap } from '../voxels-map'

const AVATAR_UPDATE_INTERVAL = 3000

export default class MapOverlayUI {
  map: VoxelsMap | null = null
  parcels: MapParcelRecord[] = []
  abort: AbortController | null = null
  avatarMarkers: MapMarker[] = []
  updateAvatarTimer: NodeJS.Timeout | null = null
  locationMarker: MapMarker | null = null
  locationTimer: NodeJS.Timeout | null = null
  eventMarkers: MapMarker[] = []
  searchMarkers: MapMarker[] = []
  divMap: HTMLDivElement | null = null

  constructor(
    private scene: BABYLON.Scene,
    private onTeleport: (() => void) | undefined,
  ) {
    app.on(AppEvent.Login, this.onLoginOrOut)
    app.on(AppEvent.Logout, this.onLoginOrOut)
  }

  unmount() {
    this.map?.dispose()
    this.map = null
    if (this.divMap) {
      this.divMap.innerHTML = ''
      this.divMap = null
    }
  }

  mount(div: HTMLDivElement) {
    this.divMap = div
    div.innerHTML = ''
    const canvas = document.createElement('canvas')
    canvas.className = 'voxels-map'
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none'
    div.appendChild(canvas)

    const cam = this.scene.activeCamera
    const wallet = app.state.wallet || undefined

    this.map = new VoxelsMap(canvas, {
      ortho: PAGE_ORTHO / 4,
      parcels: true,
      nav: true,
      arrow: this.scene,
      wallet,
      onClick: this.onMapClick,
    })

    if (cam) this.map.setView(cam.position.x, cam.position.z)

    this.map.load().then(() => {
      this.parcels = this.map!.getParcels() as MapParcelRecord[]
    })

    this.addCurrentLocationMarker()
    this.renderSearchBar()
    this.addAvatars()
    this.addLiveEvents()
  }

  onLoginOrOut = () => {
    this.map?.setWallet(app.state.wallet || undefined)
  }

  renderSearchBar() {
    if (!this.divMap) return
    if (this.divMap.querySelector('.SearchMapBar')) return

    const el = document.createElement('div')
    el.className = 'SearchMapBar'
    this.divMap.appendChild(el)
    render(<SearchMap mapContext={this} />, el)
  }

  onMapClick = (x: number, z: number) => {
    if (!this.map) return
    const parcel = this.map.parcelAt(x, z)
    if (parcel) {
      mapParcelPopup(this.map, x, z, parcel, (url) => {
        window.persona.teleport(url)
        this.onTeleport?.()
      })
      return
    }
    mapTeleportPopup(this.map, x, z, (url: string) => {
      window.persona.teleport(url)
      this.onTeleport?.()
    })
  }

  dispose() {
    this.abort?.abort('ABORT: quitting component')
    this.abort = null
    if (this.updateAvatarTimer) {
      clearInterval(this.updateAvatarTimer)
      this.updateAvatarTimer = null
    }
    if (this.locationTimer) {
      clearInterval(this.locationTimer)
      this.locationTimer = null
    }
    this.locationMarker = null
    this.avatarMarkers = []
    this.eventMarkers = []
    this.searchMarkers = []
    this.parcels.length = 0
    app.off(AppEvent.Login, this.onLoginOrOut)
    app.off(AppEvent.Logout, this.onLoginOrOut)
    this.map?.dispose()
    this.map = null
  }

  private addAvatars() {
    if (!this.map) return

    const rebuild = () => {
      if (!this.map) return
      for (const m of this.avatarMarkers) m.remove()
      this.avatarMarkers = []
      for (const avatar of window.connector.avatarsByUuid.values()) {
        if (!avatar.hasPosition || avatar.isUser) continue
        const marker = this.map.addMarker({
          x: avatar.position.x,
          z: avatar.position.z,
          className: 'map-avatar-dot',
          title: avatar.name || '',
          html: '<span></span>',
        })
        this.avatarMarkers.push(marker)
      }
    }

    rebuild()
    this.updateAvatarTimer = setInterval(rebuild, AVATAR_UPDATE_INTERVAL)
  }

  private async addLiveEvents() {
    const live = await getLiveEvents(this.abort?.signal)
    if (!live || !this.map) return

    for (const event of live) {
      const helper = new ParcelEvent(event)
      const x = helper.latLng.lng * 100
      const z = helper.latLng.lat * 100
      const marker = this.map.addMarker({
        x,
        z,
        className: 'css-icon',
        title: `Event live now! \r\n${helper.name}`,
        html: '<div class="party"><div class="inner-circle"></div></div>',
        onClick: () => {
          if (!this.map) return
          const el = mapEventMarkerPopup(helper, (url: string | null) => {
            if (!url) return
            window.persona.teleport(url)
            this.onTeleport?.()
          })
          this.map.openPopup(x, z, el)
        },
      })
      this.eventMarkers.push(marker)
    }
  }

  private addCurrentLocationMarker() {
    const camera = this.scene.activeCamera
    if (!camera || !this.map) return

    this.locationMarker = this.map.addMarker({
      x: camera.position.x,
      z: camera.position.z,
      className: 'map-you-arrow',
      title: 'You are here!',
    })
    this.locationMarker.setRotation(playerHeadingDeg(camera))

    this.locationTimer = setInterval(() => {
      const cam = this.scene.activeCamera
      if (!cam || !this.locationMarker) return
      this.locationMarker.setPos(cam.position.x, cam.position.z)
      this.locationMarker.setRotation(playerHeadingDeg(cam))
    }, 500)
  }
}

const playerHeadingDeg = (camera: BABYLON.Camera) => (camera instanceof BABYLON.TargetCamera ? (camera.rotation.y * 180) / Math.PI : 0)

export const calculateLatLng = (parcel: MapParcelRecord) => {
  const center = parcel.x2 ? [(parcel.x2 + parcel.x1) / 200, (parcel.z2 + parcel.z1) / 200] : [0, 0]
  return { lat: center[1], lng: center[0] }
}

export function SearchMap({ mapContext }: { mapContext: MapOverlayUI }) {
  const clear = () => {
    for (const m of mapContext.searchMarkers) m.remove()
    mapContext.searchMarkers = []
  }

  const search = (value: string) => {
    clear()
    if (!value || !mapContext.map) return

    const searchRegex = new RegExp(value, 'i')
    const ownerStr = (p: any) => (typeof p.owner === 'string' ? p.owner : (p.owner?.name ?? ''))
    const list = mapContext.parcels.filter((p) => p.name?.match(searchRegex) || p.label?.match(searchRegex) || p.address?.match(searchRegex) || ownerStr(p).match(searchRegex))

    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity

    for (const p of list) {
      const x = (p.x1 + p.x2) / 2
      const z = (p.z1 + p.z2) / 2
      mapContext.searchMarkers.push(
        mapContext.map.addMarker({
          x,
          z,
          className: 'map-search-dot',
          title: p.name ?? p.address ?? '',
          html: '<span></span>',
        }),
      )
      minX = Math.min(minX, p.x1)
      minZ = Math.min(minZ, p.z1)
      maxX = Math.max(maxX, p.x2)
      maxZ = Math.max(maxZ, p.z2)
    }

    if (list.length) mapContext.map.fitBounds(minX, minZ, maxX, maxZ)
  }

  const onSearch = debounce(search, 800, { trailing: true, leading: false })

  return <input type="text" autoFocus placeholder={'Search...'} name="search" onInput={(e) => onSearch(e.currentTarget.value)} onClick={(e) => e.stopPropagation()} />
}

async function getLiveEvents(signal?: AbortSignal): Promise<Event[] | null> {
  return await fetch(`/api/events/on.json?live=true`, { signal, credentials: 'include' })
    .then((r) => r.json())
    .then((res: any) => res?.events || [])
    .catch(console.error)
}

type Empty = Record<string, never>
type BigMapProps = { scene: BABYLON.Scene; onTeleport?: () => void }

export class BigMap extends Component<BigMapProps, Empty> {
  private static className = 'map map-overlay'
  div = createRef()
  map: MapOverlayUI | null = null

  shouldComponentUpdate() {
    return false
  }

  componentDidMount() {
    this.map = new MapOverlayUI(this.props.scene, this.props.onTeleport)
    this.map.mount(this.div.current)
  }

  componentWillUnmount() {
    this.map?.unmount()
    this.map?.dispose()
    this.map = null
  }

  render() {
    return <div class={BigMap.className} ref={this.div} />
  }
}
