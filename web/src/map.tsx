import { ExponentialBackoff, handleAll, retry } from 'cockatiel'

import { maxBy } from 'lodash'
import { Component } from 'preact'
import { render } from 'preact/compat'
import ParcelHelper, { getParcelHelper } from '../../common/helpers/parcel-helper'
import { decodeCoords, encodeCoords } from '../../common/helpers/utils'
import { MapParcelRecord } from '../../common/messages/api-parcels'
import type MapOverlayUI from '../../src/ui/map-overlay'
import { Womp, WompCard } from './components/womp-card'
import { mapParcelPopup, mapTeleportPopup } from './map-parcel-popup'
import { app, AppEvent } from './state'
import { fetchOptions } from './utils'

const retryPolicy = retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff() })

let L = window.L as typeof window.L & { markerClusterGroup: any; markerClusterGroupLayerSupport: any }
/**
 *
 * GeoJson feature with parcel properties
 */
type ParcelFeature = any

interface Props {
  parcel?: MapParcelRecord
  path?: string
  id?: number
  forSale?: { id: number; price: number }[]
}

const priceLabel = (n: number) => `${parseFloat(n.toFixed(2))}Ξ`

interface State {
  parcels: MapParcelRecord[]
  querying?: boolean
  price?: number
  txn?: any
  overlayMaps?: any
  embed: boolean
  resizeDetector: boolean // Toggling this forces a redraw when ?embed=true
}

export const LABELS_LIST = [
  'gallery',
  'club',
  'bar',
  'teleports',
  'library',
  'park',
  'animal',
  'shops',
  'scenic',
  'beach',
  'factory',
  'sports',
  'rest',
  'education',
  'game',
  'music',
  'money',
  'concert',
  'food',
  'theater',
  'sandbox',
] as const

async function loadScript(url: string): Promise<void> {
  const id = url.split('.js')[0]
  if (document.getElementById(id)) {
    return // already loaded
  }
  const scriptTag = document.createElement('script')
  scriptTag.setAttribute('type', 'text/javascript')
  scriptTag.setAttribute('src', url)
  scriptTag.id = id

  document.getElementsByTagName('head')[0].appendChild(scriptTag)

  return new Promise((resolve, reject) => {
    scriptTag.onload = () => {
      resolve()
    }

    scriptTag.onerror = (err) => {
      console.error('Error loading script')
      reject(err)
    }
  })
}

export default class WorldMap extends Component<Props, State> {
  map: L.Map | undefined
  layerControl: L.Control.Layers | undefined
  mapRenderer: L.Canvas | undefined
  parcelLayers: L.GeoJSON<{
    parcel: MapParcelRecord
  }>[] = []
  abortController: AbortController | null = null
  forSaleLayer: L.LayerGroup | undefined
  forSaleMarkers: Record<number, L.Marker> = {}

  constructor() {
    super()

    this.resizeHandler = this.resizeHandler.bind(this)

    const q = new URLSearchParams(document.location.search.substring(1))

    this.state = { parcels: [], embed: !!q.get('embed'), resizeDetector: false }

    // Set or clear the map on state change
    app.on(AppEvent.Login, this.onLoginOrOut)
    app.on(AppEvent.Logout, this.onLoginOrOut)
  }

  get queryParams(): URLSearchParams {
    return new URLSearchParams(document.location.search.substring(1))
  }

  get coords(): [number, number] | undefined {
    if (this.queryParams.get('coords')) {
      const { position } = decodeCoords(this.queryParams.get('coords'))
      return [position.z / 100, position.x / 100]
    }
  }

  get parcels() {
    return this.state.parcels
  }

  get userWallet() {
    return app.state.wallet
  }

  setStateAsync(state: Partial<State>): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  onLoginOrOut = () => {
    this.parcelLayers &&
      this.parcelLayers.map((layer) => {
        // remove owned|contributor parcels from layerControl & Ignore error from parcelsNonEditable.
        try {
          this.layerControl?.removeLayer(layer)
        } catch {}
        layer.remove()
      })
    this.addParcelFeatures()
  }

  async componentDidMount() {
    if (this.abortController) {
      this.abortController.abort('ABORT: quitting component')
    }
    this.abortController = new AbortController()

    window.addEventListener('resize', this.resizeHandler, { passive: true })
    await this.load()

    this.addMap()

    await this.loadMarkerClusterScript()

    this.addIcons()

    this.addParcelFeatures()

    // the split for-sale view sizes the map via CSS after mount; nudge leaflet to recompute
    setTimeout(() => this.map?.invalidateSize(), 0)
    this.addForSaleMarkers()
  }

  componentDidUpdate(prev: Props) {
    // listings arrive async in the for-sale page; (re)draw pins when they change
    if (prev.forSale !== this.props.forSale) this.addForSaleMarkers()
  }

  // price pins for listed parcels so the map reads like a zillow board next to the list
  addForSaleMarkers = () => {
    if (!this.map) return

    if (this.forSaleLayer) {
      this.forSaleLayer.remove()
      this.forSaleLayer = undefined
    }
    this.forSaleMarkers = {}

    const forSale = this.props.forSale
    if (!forSale?.length || !this.state.parcels?.length) return

    const byId: Record<number, MapParcelRecord> = {}
    for (const p of this.state.parcels) byId[p.id] = p

    const layer = L.layerGroup()
    const latlngs: L.LatLngExpression[] = []

    for (const item of forSale) {
      const parcel = byId[item.id]
      if (!parcel) continue
      const latLng = new ParcelHelper(parcel).latLng
      const icon = L.divIcon({ className: 'for-sale-pin', html: `<span>${priceLabel(item.price)}</span>` })
      const marker = L.marker(latLng, { renderer: this.mapRenderer, icon } as L.MarkerOptions)
      marker.on('click', () => window.location.assign(`/parcels/${item.id}`))
      marker.addTo(layer)
      this.forSaleMarkers[item.id] = marker
      latlngs.push(latLng)
    }

    layer.addTo(this.map)
    this.forSaleLayer = layer

    if (latlngs.length) this.map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 14 })
  }

  // called from the listing cards on hover to connect list <-> map
  highlightParcel = (id: number | null) => {
    for (const key of Object.keys(this.forSaleMarkers)) {
      const el = (this.forSaleMarkers[+key] as any)?._icon as HTMLElement | undefined
      if (el) el.classList.toggle('active', +key === id)
    }
  }

  async loadMarkerClusterScript(): Promise<void> {
    if (!window.L) {
      console.error('Leaflet not loaded')
      return
    }
    if (L?.markerClusterGroup?.layerSupport) {
      return // already loaded
    }
    await loadScript('/vendor/leaflet.markercluster.js')

    await loadScript('/vendor/leaflet.markercluster.layersupport.js')
    if (!L?.markerClusterGroup?.layerSupport) {
      console.error('MarkerClusterGroup not loaded')

      throw new Error('MarkerClusterGroup failed to load')
    }
  }

  async load() {
    const { parcels } = await retryPolicy.execute(
      () =>
        fetch(`${process.env.API}/parcels/map.json`, fetchOptions(this.abortController ?? undefined)).then((res) => {
          if (!res.ok) {
            throw new Error(`Error fetching parcels: ${res.status}`)
          }
          return res.json()
        }),
      this.abortController?.signal,
    )

    await this.setStateAsync({ parcels })
  }

  componentWillUnmount() {
    removeEventListener('resize', this.resizeHandler)
    if (this.map) {
      this.map.remove()
    }
    this.abortController?.abort('ABORT: quitting component')
    this.abortController = null
  }

  async addIcons() {
    if (!this.map) {
      return
    }
    //custom icon
    const InfoInco = L.Icon.extend({
      options: {
        iconSize: [18, 17],
        shadowSize: [19, 18],
        iconAnchor: [8, 14],
        shadowAnchor: [8, 14],
        popupAnchor: [8, 14],
      },
    })

    // First, group parcels by label.
    const parcelsByLabel: Record<string, MapParcelRecord[]> = {}

    this.state.parcels.forEach((parcel) => {
      if (!parcel.label) {
        if (parcel.settings?.sandbox === true) {
          // special case for special parcels
          parcel.label = 'sandbox'
        } else {
          return
        }
      }

      if (!parcelsByLabel[parcel.label]) {
        parcelsByLabel[parcel.label] = []
      }

      parcelsByLabel[parcel.label].push(parcel)
    })

    for (const label of LABELS_LIST) {
      // @ts-expect-error we must have extended L.Icon
      const icon = new InfoInco({
        label,
        iconUrl: `./icons/mapIcons/${label}_icon.png`,
        shadowUrl: `./icons/mapIcons/${label}_icon_shadow.png`,
      })

      const parcels = parcelsByLabel[label] || []

      const myMarkers = L.layerGroup()

      for (const p of parcels) {
        const helper = new ParcelHelper(p)
        myMarkers.addLayer(
          window.L.marker(helper.latLng, {
            // Renderer is necessary for performance with many markers but not defined in types
            renderer: this.mapRenderer,
            opacity: 1,
            icon: icon,
            title: `This parcel is a ${label}!`,
            interactive: false,
          } as L.MarkerOptions),
        )
      }
      myMarkers.addTo(this.map)
      this.layerControl?.addOverlay(myMarkers, `<i class="map-icon ${label}"></i> ${label} - <small>${parcels.length}</small>`)

      const clusterGroups = L.markerClusterGroup.layerSupport({
        showCoverageOnHover: false,
        chunkedLoading: true,
        iconCreateFunction: function (cluster: any) {
          const m = cluster.getAllChildMarkers()
          const labelCount: Record<string, number>[] = []
          m.forEach((marker: any) => {
            const count = labelCount.find((l) => l[marker.options.icon.options.label] >= 0) as undefined | Record<string, number>
            if (count) {
              count[marker.options.icon.options.label]++
            } else {
              labelCount.push({ [marker.options.icon.options.label]: 1 })
            }
          })
          const maximum = maxBy(labelCount, (a) => Object.values(a))
          const key = Object.keys(maximum as object)
          return L.divIcon({
            html: `<div><i ></i><br /><span><b>` + cluster.getChildCount() + '</b></span></div>',
            className: 'MarkersClusters',
          })
        },
      })

      clusterGroups.addTo(this.map)
      clusterGroups.checkIn(myMarkers)
    }

    generateWompMarkers(this, this.abortController?.signal)
  }

  addMap() {
    if (this.map) {
      return
    }

    if (window && !L) {
      L = window.L as typeof window.L & { markerClusterGroup: any; markerClusterGroupLayerSupport: any }
    }

    // fix weird map reload bug
    const bm = document.querySelector('.map') as HTMLElement | null
    if (!bm) {
      console.error('No map element found')
      return
    }
    bm.innerHTML = ''
    // bm.className = 'big-map'
    ;(bm as any)['_leaflet_id'] = null

    const worldMap = L.tileLayer(`${process.env.MAP_URL}/tile?z={z}&x={x}&y={y}`, {
      minZoom: 3,
      maxZoom: 20,
      attribution: 'Map data &copy; Voxels',
      id: 'Voxels',
    })

    this.map = L.map(bm, { layers: [worldMap], preferCanvas: true }) as L.Map

    if (this.coords) {
      this.map.setView(this.coords, 11)
    } else {
      this.map.setView([0, 0], 7)
    }

    this.mapRenderer = L.canvas({ padding: 0.5 })

    this.map.on('click', this.showTeleportHere)
  }

  addParcelFeatures = () => {
    if (!this.map) {
      console.error('Map not initialized')
      return
    }
    console.debug('addParcelFeatures')
    const onEachFeature = (feature: ParcelFeature, layer: L.Layer) => {
      layer.on('click', (e: L.LeafletMouseEvent) => {
        if (!this.map) {
          console.error('Map not initialized')
          return
        }
        mapParcelPopup(this.map, e.latlng, feature.properties.parcel, (url) => {
          if (this.state.embed) {
            window.opener.location.href = url
            window.close()
          } else {
            window.location.assign(url)
          }
        })
        // This will throw an error even though it is acting properly
        L.DomEvent && L.DomEvent.stopPropagation && L.DomEvent.stopPropagation(e)
      })
    }

    const other = {
      renderer: this.mapRenderer,
      color: '#333333',
      opacity: 0,
      fillColor: '#ffffff',
      fillOpacity: 0,
      dashArray: '5,5',
      weight: 4,
    }

    const mine = {
      renderer: this.mapRenderer,
      color: '#fb6728',
      opacity: 1,
      fillOpacity: 0,
      dashArray: '5,5',
      weight: 4,
    }
    const othersButIHelp = {
      renderer: this.mapRenderer,
      color: '#84f0d8',
      opacity: 1,
      fillOpacity: 0,
      dashArray: '5,5',
      weight: 4,
    }

    const rented = {
      renderer: this.mapRenderer,
      color: '#fbcd28',
      opacity: 1,
      fillOpacity: 0,
      dashArray: '5,5',
      weight: 4,
    }
    const commons = {
      renderer: this.mapRenderer,
      color: '#16ad04',
      opacity: 1,
      fillOpacity: 0.1,
      dashArray: '5,5',
      weight: 1.5,
    }
    const sandboxes = {
      renderer: this.mapRenderer,
      color: '#ebcf34',
      opacity: 1,
      fillOpacity: 0.1,
      dashArray: '5,5',
      weight: 4,
    }

    const owned = 'Parcels I own'
    const collab = 'Parcels I contribute to'
    /* Layer changes */
    /* Optional layer groups */
    const overlayMaps: Record<
      string,
      | L.GeoJSON<{
          parcel: MapParcelRecord
        }>
      | undefined
    > = {}
    const userWallet = this.userWallet

    if (userWallet && this.parcels) {
      const ownedParcels: MapParcelRecord[] = []
      const contributorParcels: MapParcelRecord[] = []
      const otherParcels: MapParcelRecord[] = []
      const commonsWithBuildRightsParcels: MapParcelRecord[] = []
      const rentedParcels: MapParcelRecord[] = []

      const commonsParcels: MapParcelRecord[] = []

      const sandboxParcels: MapParcelRecord[] = []

      const ownedSuburbs: Set<string> = new Set()

      for (const parcel of this.parcels) {
        const help = getParcelHelper(parcel)
        if (help.is_common) {
          commonsParcels.push(parcel)
        }
        if (help.isSandbox) {
          sandboxParcels.push(parcel)
        }

        if (help.isOwner(userWallet)) {
          if (help.is_common) {
            commonsWithBuildRightsParcels.push(parcel)
          } else {
            ownedParcels.push(parcel)
            ownedSuburbs.add(parcel.suburb)
          }
        } else if (help.isContributor(userWallet)) {
          contributorParcels.push(parcel)
        } else {
          otherParcels.push(parcel)
        }
      }

      const parcelsNonEditable: L.GeoJSON<{
        parcel: MapParcelRecord
      }> = L.geoJSON(
        otherParcels.map((p) => {
          return { type: 'Feature', geometry: p.geometry, properties: { parcel: p } }
        }),
        { style: other, onEachFeature },
      )
      parcelsNonEditable.addTo(this.map)

      for (const commonParcel of commonsParcels) {
        if (ownedSuburbs.has(commonParcel.suburb)) {
          commonsWithBuildRightsParcels.push(commonParcel)
        }
      }

      const commonsWithBuildRightsParcelsGeojson: L.GeoJSON<{
        parcel: MapParcelRecord
      }> = L.geoJSON(
        commonsWithBuildRightsParcels.map((p): ParcelFeature => {
          return { type: 'Feature' as const, geometry: p.geometry, properties: { parcel: p } }
        }),
        { style: commons, onEachFeature },
      )
      commonsWithBuildRightsParcelsGeojson.addTo(this.map)

      const rentedParcelsGeojson: L.GeoJSON<{
        parcel: MapParcelRecord
      }> = L.geoJSON(
        rentedParcels.map((p): ParcelFeature => {
          return { type: 'Feature' as const, geometry: p.geometry, properties: { parcel: p } }
        }),
        { style: rented, onEachFeature },
      )
      rentedParcelsGeojson.addTo(this.map)

      const parcelsIown: L.GeoJSON<{
        parcel: MapParcelRecord
      }> = L.geoJSON(
        ownedParcels.map((p) => {
          return { type: 'Feature', geometry: p.geometry, properties: { parcel: p } }
        }),
        { style: mine, onEachFeature },
      )
      overlayMaps[owned] = parcelsIown
      parcelsIown.addTo(this.map)

      const parcelsIcontribute: L.GeoJSON<{
        parcel: MapParcelRecord
      }> = L.geoJSON(
        contributorParcels?.map((p) => {
          return { type: 'Feature', geometry: p.geometry, properties: { parcel: p } }
        }),
        { style: othersButIHelp, onEachFeature },
      )
      overlayMaps[collab] = parcelsIcontribute
      parcelsIcontribute.addTo(this.map)

      const sandboxesGeojson: L.GeoJSON<{
        parcel: MapParcelRecord
      }> = L.geoJSON(
        sandboxParcels.map((p): ParcelFeature => {
          return { type: 'Feature' as const, geometry: p.geometry, properties: { parcel: p } }
        }),
        { style: sandboxes, onEachFeature },
      )
      sandboxesGeojson.addTo(this.map)

      this.parcelLayers = [parcelsIcontribute, parcelsNonEditable, parcelsIown, rentedParcelsGeojson, commonsWithBuildRightsParcelsGeojson, sandboxesGeojson]
    } else {
      const allLayers = L.geoJSON(
        this.state.parcels?.map((p) => {
          return { type: 'Feature', geometry: p.geometry, properties: { parcel: p } }
        }),
        { style: other, onEachFeature },
      )
      allLayers.addTo(this.map)
      this.parcelLayers = [allLayers]
    }

    if (!this.layerControl) {
      console.error('Layer control not initialized')
      return
    }
    //this.layerControl.addBaseLayer(layerMaps)
    overlayMaps[collab] && this.layerControl.addOverlay(overlayMaps[collab], collab)
    overlayMaps[owned] && this.layerControl.addOverlay(overlayMaps[owned], owned)
  }

  showTeleportHere = (e: L.LeafletMouseEvent) => {
    if (!this.map) {
      console.error('Map not initialized')
      return
    }
    mapTeleportPopup(this.map, e.latlng, (url) => {
      if (this.state.embed) {
        window.opener.location.href = url
        window.close()
      } else {
        window.location.assign(url)
      }
    })
  }

  render() {
    if (!this.state.parcels) {
      return <p>Loading...</p>
    }

    const style = this.state.embed ? { height: '100vh', width: '100vw' } : { height: '95%', width: '100%' }

    return (
      <section class="worldmap">
        {this.props.path === '/map' && (
          <a class="map-for-sale-cta" href="/shop">
            land for sale
          </a>
        )}
        <div class="map map-web" />
      </section>
    )
  }

  private resizeHandler() {
    if (this.state.embed) {
      this.setState({ resizeDetector: !this.state.resizeDetector })
    }
  }
}

const getWomps = async (signal?: AbortSignal) => {
  const url = `${process.env.API}/womps.json?limit=50&kind=broadcast`
  const p = await fetch(`${url}`, { method: 'get', signal, credentials: 'include' }).then((r) => r.json())

  return (p?.womps || []) as Womp[]
}

export async function generateWompMarkers(mapContext: WorldMap | MapOverlayUI, signal?: AbortSignal) {
  if (!mapContext.map) {
    console.error('Map not initialized')
    return
  }
  const womps = (await getWomps(signal)).reverse()

  const image = './images/camera-transparent.png'
  const shadow = './images/camera-transparent-shadow.png'

  if (!womps.length) {
    return
  }

  const WompIcon = L.Icon.extend({
    options: {
      iconSize: [32, 32],
      shadowSize: [33, 33],
      iconAnchor: [16, 30],
      shadowAnchor: [16, 30],
      popupAnchor: [1, -30],
      tooltipAnchor: [0, -1],
    },
  })

  // const icon = new WompIcon({
  //   iconUrl: image,
  //   // shadowUrl: shadow,
  // })

  const clusterGroups = L.markerClusterGroup.layerSupport({
    showCoverageOnHover: false,
    chunkedLoading: true,
    iconCreateFunction: function (cluster: any) {
      const m = cluster.getAllChildMarkers()
      const labelCount: Record<string, number>[] = []
      m.forEach((marker: any) => {
        const count = labelCount.find((l) => l[marker.options.icon.options.label] >= 0) as undefined | Record<string, number>
        if (count) {
          count[marker.options.icon.options.label]++
        } else {
          labelCount.push({ [marker.options.icon.options.label]: 1 })
        }
      })
      // const maximum = maxBy(labelCount, (a) => Object.values(a))

      return L.divIcon({ html: `<div><span style="color:#000;">` + cluster.getChildCount() + '</span><div class="map-icon womp" style="width:20px;" /></div>', className: 'MarkersClusters -avatar' })
    },
  })
  clusterGroups.addTo(mapContext.map)

  const wompMarkers = L.layerGroup()

  for (const womp of womps) {
    // @ts-expect-error we must have extended L.Icon
    const icon = new WompIcon({
      iconUrl: womp.image_url,
      // shadowUrl: shadow,
    })

    const parcel = mapContext.parcels?.find((p) => p.id === womp.parcel_id)
    womp.parcel_name = parcel?.name || `Parcel ${womp.id}`
    womp.parcel_address = parcel?.address || womp.coords

    const coords = decodeCoords(womp.coords)

    const marker = L.marker([coords.position.z / 100, coords.position.x / 100], {
      // Renderer is necessary for performance with many markers but not defined in types
      renderer: mapContext.mapRenderer ?? undefined,
      opacity: 1,
      icon: icon,
      title: `Womp near ${womp.parcel_address}`,
    } as L.MarkerOptions)

    const div = document.createElement('div')
    // div.className = 'womp'
    marker.bindPopup(div, { className: 'wompcard-popup' })
    render(<WompCard key={womp.id} womp={womp} className={'-compact'} />, div)

    !!clusterGroups && clusterGroups?.checkIn(wompMarkers)
    wompMarkers.addLayer(marker)
  }

  wompMarkers.addTo(mapContext.map)
  mapContext.layerControl?.addOverlay(wompMarkers, `<i class="map-icon womp"></i> latest Womps`)
}
