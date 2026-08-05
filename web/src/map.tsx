import { Component, createRef } from 'preact'
import { decodeCoords } from '../../common/helpers/utils'
import { MapParcelRecord } from '../../common/messages/api-parcels'
import type { MapMarker, VoxelsMap } from './helpers/load-voxels-map'
import { loadVoxelsMap } from './helpers/load-voxels-map'
import { mapParcelPopup, mapTeleportPopup } from './map-parcel-popup'
import { app, AppEvent } from './state'

const priceLabel = (n: number) => `${parseFloat(n.toFixed(2))}Ξ`
const SHOP_LIST_ORTHO = 9000
const DETAIL_ORTHO = 200
const PAGE_ORTHO = 2000

interface Props {
  parcel?: MapParcelRecord
  path?: string
  id?: number
  forSale?: { id: number; price: number; label?: string }[]
  selectedForSale?: number | null
  onForSaleSelect?: (id: number) => void
  onForSaleViewportChange?: (ids: number[]) => void
  priceFmt?: string
}

interface State {
  embed: boolean
}

export default class WorldMap extends Component<Props, State> {
  map: VoxelsMap | null = null
  canvasRef = createRef<HTMLCanvasElement>()
  forSaleMarkers: Record<number, MapMarker> = {}
  forSaleViewInitialized = false
  parcels: MapParcelRecord[] = []

  constructor() {
    super()
    const q = new URLSearchParams(document.location.search.substring(1))
    this.state = { embed: !!q.get('embed') }
    app.on(AppEvent.Login, this.onLoginOrOut)
    app.on(AppEvent.Logout, this.onLoginOrOut)
  }

  get queryParams(): URLSearchParams {
    return new URLSearchParams(document.location.search.substring(1))
  }

  get coords(): { x: number; z: number } | undefined {
    if (this.queryParams.get('coords')) {
      const { position } = decodeCoords(this.queryParams.get('coords'))
      return { x: position.x, z: position.z }
    }
  }

  onLoginOrOut = () => {
    this.map?.setWallet(app.state.wallet || undefined)
  }

  async componentDidMount() {
    const canvas = this.canvasRef.current
    if (!canvas) return

    const { VoxelsMap } = await loadVoxelsMap()
    this.map = new VoxelsMap(canvas, {
      ortho: this.props.onForSaleSelect ? SHOP_LIST_ORTHO : PAGE_ORTHO,
      parcels: true,
      nav: true,
      wallet: app.state.wallet || undefined,
      onClick: this.onMapClick,
      onMove: this.notifyForSaleViewport,
    })

    if (this.coords) {
      this.map.setView(this.coords.x, this.coords.z, DETAIL_ORTHO)
    } else if (this.props.onForSaleSelect) {
      this.map.setView(0, 0, SHOP_LIST_ORTHO)
      this.forSaleViewInitialized = true
    }

    await this.map.load()
    this.parcels = this.map.getParcels() as MapParcelRecord[]
    this.addForSaleMarkers()
  }

  componentDidUpdate(prev: Props) {
    const forSaleIdsSame = prev.forSale?.length === this.props.forSale?.length && !!prev.forSale?.every((item, i) => item.id === this.props.forSale?.[i]?.id)

    if (prev.priceFmt !== this.props.priceFmt && forSaleIdsSame && this.updateForSalePinLabels()) {
      // done
    } else if (prev.forSale !== this.props.forSale || prev.priceFmt !== this.props.priceFmt) {
      this.addForSaleMarkers()
    }
    if (prev.selectedForSale !== this.props.selectedForSale && this.props.selectedForSale) this.focusParcel(this.props.selectedForSale)
  }

  componentWillUnmount() {
    this.map?.dispose()
    this.map = null
    app.off(AppEvent.Login, this.onLoginOrOut)
    app.off(AppEvent.Logout, this.onLoginOrOut)
  }

  onMapClick = (x: number, z: number) => {
    if (!this.map) return
    const parcel = this.map.parcelAt(x, z)
    const go = (url: string) => {
      if (this.state.embed) {
        window.opener.location.href = url
        window.close()
      } else {
        window.location.assign(url)
      }
    }
    if (parcel) {
      mapParcelPopup(this.map, x, z, parcel, go)
      return
    }
  }

  updateForSalePinLabels = () => {
    const forSale = this.props.forSale
    if (!forSale?.length) return false

    for (const item of forSale) {
      const marker = this.forSaleMarkers[item.id]
      const span = marker?.el.querySelector('span')
      if (!span) return false
      span.textContent = item.label ?? priceLabel(item.price)
    }
    return true
  }

  addForSaleMarkers = () => {
    if (!this.map) return

    const keepView = Object.keys(this.forSaleMarkers).length > 0

    for (const key of Object.keys(this.forSaleMarkers)) this.forSaleMarkers[+key].remove()
    this.forSaleMarkers = {}

    const forSale = this.props.forSale
    if (!forSale?.length || !this.parcels.length) return

    const byId: Record<number, MapParcelRecord> = {}
    for (const p of this.parcels) byId[p.id] = p

    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity
    let any = false

    for (const item of forSale) {
      const parcel = byId[item.id]
      if (!parcel) continue
      const x = (parcel.x1 + parcel.x2) / 2
      const z = (parcel.z1 + parcel.z2) / 2
      const marker = this.map.addMarker({
        x,
        z,
        className: 'for-sale-pin',
        html: `<span>${item.label ?? priceLabel(item.price)}</span>`,
        onClick: () => {
          if (this.props.onForSaleSelect) this.props.onForSaleSelect(item.id)
          else window.location.assign(`/parcels/${item.id}`)
        },
      })
      this.forSaleMarkers[item.id] = marker
      minX = Math.min(minX, parcel.x1)
      minZ = Math.min(minZ, parcel.z1)
      maxX = Math.max(maxX, parcel.x2)
      maxZ = Math.max(maxZ, parcel.z2)
      any = true
    }

    const selected = this.props.selectedForSale
    if (selected && this.forSaleMarkers[selected]) {
      if (keepView) this.highlightParcel(selected)
      else this.focusParcel(selected)
    } else if (this.props.onForSaleSelect) {
      if (!keepView && !this.forSaleViewInitialized) {
        this.map.setView(0, 0, SHOP_LIST_ORTHO)
        this.forSaleViewInitialized = true
      }
    } else if (any) {
      this.map.fitBounds(minX, minZ, maxX, maxZ)
    }

    this.notifyForSaleViewport()
  }

  getVisibleForSaleIds = (): number[] => {
    if (!this.map) return []
    const b = this.map.getBounds()
    const ids: number[] = []
    for (const key of Object.keys(this.forSaleMarkers)) {
      const m = this.forSaleMarkers[+key]
      if (m.x >= b.x1 && m.x <= b.x2 && m.z >= b.z1 && m.z <= b.z2) ids.push(+key)
    }
    return ids
  }

  notifyForSaleViewport = () => {
    if (!this.props.onForSaleViewportChange) return
    this.props.onForSaleViewportChange(this.getVisibleForSaleIds())
  }

  focusParcel = (id: number | null, ortho = DETAIL_ORTHO) => {
    if (!this.map || !id) return
    const marker = this.forSaleMarkers[id]
    if (!marker) return
    this.map.flyTo(marker.x, marker.z, ortho)
    this.highlightParcel(id)
  }

  resetShopListView = () => {
    if (!this.map || !this.props.onForSaleSelect) return
    this.highlightParcel(null)
    this.map.flyTo(0, 0, SHOP_LIST_ORTHO)
  }

  highlightParcel = (id: number | null) => {
    for (const key of Object.keys(this.forSaleMarkers)) {
      this.forSaleMarkers[+key].el.classList.toggle('active', +key === id)
    }
  }

  render() {
    return (
      <section class="worldmap">
        {this.props.path === '/map' && (
          <a class="map-for-sale-cta buttonish primary" href="/shop">
            land for sale
          </a>
        )}
        <div class="map map-web" style={{ position: 'relative', width: '100%', height: '100%' }}>
          <canvas class="voxels-map" ref={this.canvasRef} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }} />
        </div>
      </section>
    )
  }
}
