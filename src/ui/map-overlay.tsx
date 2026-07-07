import { debounce } from 'lodash'
import { Component, createRef, render, useRef } from 'preact/compat'
import { getParcelHelper } from '../../common/helpers/parcel-helper'
import type { ApiParcelMapMessage, MapParcelRecord } from '../../common/messages/api-parcels'
import type { Event } from '../../common/messages/event'
import { generateWompMarkers } from '../../web/src/map'
import { mapEventMarkerPopup, mapParcelPopup, mapTeleportPopup } from '../../web/src/map-parcel-popup'
import { app, AppEvent } from '../../web/src/state'
import { fetchOptions } from '../../web/src/utils'

import { ExponentialBackoff, handleAll, retry } from 'cockatiel'
import type { PathOptions } from '../../vendor/library/leaflet'
import ParcelEvent from '../../web/src/helpers/event'
// Create a retry policy that'll try whatever function with a randomized exponential backoff.
// to be used by fetch!
const retryPolicy = retry(handleAll, { backoff: new ExponentialBackoff(), maxAttempts: 5 })

// not sure what this is, but I hate it
class CustomControl extends window.L.Control.Layers {
  onAdd() {
    ;(this as any)._initLayout()
    this._addButton()
    ;(this as any)._update()
    return (this as any)._container
  }

  _addButton() {
    const elements = (this as any)._container.getElementsByClassName('leaflet-control-layers-list')
    const button = window.L.DomUtil.create('button', 'closeControl', elements[0])
    button.innerHTML = '<i class="fi-angle-up"></i>'
    window.L.DomEvent.on(
      button,
      'click',
      function (this: any, e) {
        window.L.DomEvent.stop(e)
        this._collapse()
      },
      this,
    )
  }
}

/**
 * GeoJson feature with parcel properties
 */
type ParcelFeature = any

const partyIcon = window.L.divIcon({
  // Specify a class name we can refer to in CSS.
  className: 'css-icon',
  html: '<div class="party"><div class="inner-circle"></div></div>',
  // Set marker width and height
  iconSize: [22, 22],
  // ,iconAnchor: [11,11]
  iconUrl: '/images/event_icon.png',
})

const AVATAR_UPDATE_INTERVAL = 3000

const LABELS_LIST = ['gallery', 'club', 'bar', 'teleports', 'library', 'park', 'animal', 'shops', 'scenic', 'beach', 'factory', 'sports', 'rest', 'education', 'game', 'music', 'money', 'concert', 'food', 'theater', 'sandbox']

export default class MapOverlayUI {
  map: L.Map | null = null
  mapRenderer: L.Canvas | null = null
  layerControl: L.Control.Layers | null = null
  editableParcels: L.GeoJSON[] = []
  otherParcels: L.GeoJSON | null = null
  iconsLoaded = false
  overlayMaps: Record<string, L.GeoJSON> = {}
  parcels: MapParcelRecord[] = []
  divMap: HTMLDivElement | null = null
  abort: AbortController | null = null
  avatarLayer: L.LayerGroup | null = null
  updateAvatarTimer: NodeJS.Timeout | null = null
  locationMarker: L.Marker | null = null
  locationTimer: NodeJS.Timeout | null = null

  constructor(
    private scene: BABYLON.Scene,
    private onTeleport: (() => void) | undefined,
  ) {
    ensureMapPatched()

    // Set or clear the map on state change
    app.on(AppEvent.Login, this.onLoginOrOut)
    app.on(AppEvent.Logout, this.onLoginOrOut)
  }

  unmount() {
    console.debug('MapOverlayUI unmount')
    if (this.map) {
      this.map.off()
      this.map.remove()
    }
    if (this.divMap) {
      this.divMap.remove()
      this.divMap = null
    }

    this.map = null
  }

  mount(div: HTMLDivElement) {
    console.debug('MapOverlayUI mount')
    this.createLeafletMap(div)

    if (!this.map) {
      console.error('Failed to create map')
      return
    }

    this.layerControl = new CustomControl({}, this.overlayMaps).addTo(this.map)

    this.loadParcels().then(() => {
      this.addIcons(this.parcels)
      this.loadParcelLayers()
    })

    this.addCurrentLocationMarker()

    generateWompMarkers(this)

    this.renderSearchBar()

    this.addAvatars()

    this.addLiveEvents()
  }

  onLoginOrOut = () => {
    this.otherParcels && this.otherParcels.remove()
    this.editableParcels &&
      this.editableParcels.map((layer) => {
        layer.remove()
      })
    this.iconsLoaded = false
    this.loadParcelLayers()
  }

  renderSearchBar() {
    if (!this.divMap) return
    if (this.divMap.querySelector('.SearchMapBar')) {
      console.error('SearchMapBar already rendered')
      return
    }

    const div = document.createElement('div')
    div.className = 'SearchMapBar'
    this.divMap.appendChild(div)
    render(<SearchMap mapContext={this} />, div)
  }

  showTeleportHere: L.LeafletMouseEventHandlerFn = (e: L.LeafletMouseEvent) => {
    if (!this.map) return
    console.debug('showTeleportHere', e.latlng)
    mapTeleportPopup(this.map, e.latlng, (url: string) => {
      window.persona.teleport(url)
      this.onTeleport?.()
    })
  }

  async addIcons(mapIcons: MapParcelRecord[]) {
    if (!this.map || !this.mapRenderer) {
      console.error('No map or mapRenderer')
      return
    }
    if (this.iconsLoaded) {
      console.warn('Icons already loaded')
      return
    }

    const InfoIcon = window.L.Icon.extend({
      options: {
        iconSize: [18, 17],
        shadowSize: [19, 18],
        iconAnchor: [8, 14],
        shadowAnchor: [8, 14],
        popupAnchor: [8, 14],
      },
    })

    for (const label of LABELS_LIST) {
      // Can remove the "as any" once https://github.com/DefinitelyTyped/DefinitelyTyped/pull/56475/files is merged
      const icon = new (InfoIcon as any)({
        iconUrl: `./icons/mapIcons/${label}_icon.png`,
        shadowUrl: `./icons/mapIcons/${label}_icon_shadow.png`,
      })

      const myMarkers: L.LayerGroup<L.Marker> = window.L.layerGroup()

      let count = 0
      for (const p of mapIcons) {
        if (p.label !== label) {
          continue
        }
        myMarkers.addLayer(
          window.L.marker(calculateLatLng(p), {
            renderer: this.mapRenderer,
            opacity: 1,
            icon: icon,
            title: `This parcel is a ${label}!`,
            interactive: false,
          } as L.MarkerOptions) as any,
        )
        count++
      }

      this.layerControl?.addOverlay(myMarkers, `<i class="map-icon ${label}"></i> ${label} - <small>${count}</small>`)
    }
    this.iconsLoaded = true
  }

  async loadParcels(): Promise<MapParcelRecord[]> {
    if (this.parcels.length) {
      console.debug('Parcels already loaded')
      return this.parcels
    }

    try {
      const abortSignal = this.abort?.signal
      const parcelsFetched = await retryPolicy.execute(async () => {
        const res = await fetch(`${process.env.API}/parcels/map.json`, fetchOptions())
        if (!res.ok) throw res
        return (await res.json()) as ApiParcelMapMessage
      }, abortSignal)
      if (abortSignal?.aborted) {
        return [] // Abort was called
      }
      if (parcelsFetched?.parcels) {
        this.parcels = parcelsFetched.parcels
      }
      return this.parcels
    } catch (error) {
      console.error('Error fetching parcels', error)
      return []
    }
  }

  dispose() {
    this.abort?.abort('ABORT: quitting component')
    this.abort = null
    this.map?.remove()
    this.map = null
    this.layerControl?.remove()
    this.layerControl = null
    this.mapRenderer = null
    this.parcels.length = 0
    this.otherParcels?.clearLayers()
    this.otherParcels = null
    app.off(AppEvent.Login, this.onLoginOrOut)
    app.off(AppEvent.Logout, this.onLoginOrOut)
    if (this.updateAvatarTimer) {
      clearInterval(this.updateAvatarTimer)
      this.updateAvatarTimer = null
    }
    if (this.locationTimer) {
      clearInterval(this.locationTimer)
      this.locationTimer = null
    }
    this.locationMarker = null
    this.editableParcels.length = 0

    this.overlayMaps = {}

    this.avatarLayer?.clearLayers()
    this.avatarLayer = null
  }

  getParcelLayerStyles() {
    const renderer = this.mapRenderer ?? undefined
    const other: PathOptions = {
      renderer,
      color: '#333333',
      opacity: 0,
      fillColor: '#ffffff',
      fillOpacity: 0,
      dashArray: '5,5',
      weight: 4,
    }
    const mine: PathOptions = {
      renderer,
      color: '#fb6728',
      opacity: 1,
      fillOpacity: 0,
      dashArray: '5,5',
      weight: 4,
    }
    const othersButIHelp: PathOptions = {
      renderer,
      color: '#84f0d8',
      opacity: 1,
      fillOpacity: 0,
      dashArray: '5,5',
      weight: 4,
    }
    const rented: PathOptions = {
      renderer,
      color: '#fbcd28',
      opacity: 1,
      fillOpacity: 0,
      dashArray: '5,5',
      weight: 4,
    }
    const commons: PathOptions = {
      renderer,
      color: '#16ad04',
      opacity: 1,
      fillOpacity: 0.1,
      dashArray: '5,5',
      weight: 1.5,
    }
    const sandboxes: PathOptions = {
      renderer,
      color: '#ebcf34',
      opacity: 1,
      fillOpacity: 0.1,
      dashArray: '5,5',
      weight: 4,
    }

    return {
      other,
      mine,
      othersButIHelp,
      rented,
      commons,
      sandboxes,
    } as const
  }

  async loadParcelLayers() {
    if (!this.map || !this.mapRenderer) {
      throw new Error('No map')
    }

    const onEachFeature = (feature: ParcelFeature, layer: L.Layer) => {
      layer.on('click', async (e) => {
        if (!this.map) {
          console.warn('No map')
          return
        }
        mapParcelPopup(this.map, e.latlng, feature.properties.parcel, (url) => {
          // when used with in world map
          window.persona.teleport(url)
          this.onTeleport?.()
        })
        // Stop propagation of click
        window.L.DomEvent?.stopPropagation && window.L.DomEvent.stopPropagation(e)
      })
    }

    const { other, mine, othersButIHelp, rented, commons, sandboxes } = this.getParcelLayerStyles()

    if (!app.signedIn) {
      // if not logged in just show all as other
      this.otherParcels = window.L.geoJSON(
        this.parcels.map((p): ParcelFeature => {
          return { type: 'Feature' as const, geometry: p.geometry, properties: { parcel: p } }
        }),
        { style: other, onEachFeature },
      ).addTo(this.map)
      return
    }

    // catergorise parcels
    const ownedParcels: ParcelFeature[] = []
    const contributorParcels: ParcelFeature[] = []
    const otherParcels: ParcelFeature[] = []
    const commonsWithBuildRightsParcels: ParcelFeature[] = []
    const rentedParcels: ParcelFeature[] = []
    const commonsParcels: ParcelFeature[] = []
    const sandboxParcels: ParcelFeature[] = []

    const ownedSuburbs: Set<string> = new Set()

    const user = window.user

    for (const parcel of this.parcels) {
      const help = getParcelHelper(parcel)
      if (help.is_common) {
        commonsParcels.push({ type: 'Feature' as const, geometry: parcel.geometry, properties: { parcel } })
      }

      if (help.isSandbox) {
        sandboxParcels.push({ type: 'Feature' as const, geometry: parcel.geometry, properties: { parcel } })
      }

      if (help.isOwner(user.wallet)) {
        if (help.is_common) {
          commonsWithBuildRightsParcels.push({ type: 'Feature' as const, geometry: parcel.geometry, properties: { parcel } })
        } else {
          ownedParcels.push({ type: 'Feature' as const, geometry: parcel.geometry, properties: { parcel } })
          ownedSuburbs.add(parcel.suburb)
        }
      } else if (help.isContributor(user.wallet)) {
        contributorParcels.push({ type: 'Feature' as const, geometry: parcel.geometry, properties: { parcel } })
      } else {
        otherParcels.push({ type: 'Feature' as const, geometry: parcel.geometry, properties: { parcel } })
      }
    }

    for (const commonParcel of commonsParcels) {
      if (ownedSuburbs.has(commonParcel.properties.parcel.suburb)) {
        commonsWithBuildRightsParcels.push(commonParcel)
      }
    }

    this.otherParcels = window.L.geoJSON(otherParcels, { style: other, onEachFeature }).addTo(this.map)

    const commonsWithBuildRightsParcelsGeojson = window.L.geoJSON(commonsWithBuildRightsParcels, {
      style: commons,
      onEachFeature,
    }).addTo(this.map)

    const myParcelsGeojson = window.L.geoJSON(ownedParcels, { style: mine, onEachFeature }).addTo(this.map)

    const myContributorParcels = window.L.geoJSON(contributorParcels, { style: othersButIHelp, onEachFeature }).addTo(this.map)

    const rentedParcelsGeojson = window.L.geoJSON(rentedParcels, { style: rented, onEachFeature }).addTo(this.map)

    const sandboxesGeojson = window.L.geoJSON(sandboxParcels, { style: sandboxes, onEachFeature }).addTo(this.map)

    this.editableParcels = [myParcelsGeojson, myContributorParcels, commonsWithBuildRightsParcelsGeojson, rentedParcelsGeojson, sandboxesGeojson]
  }

  private createLeafletMap(div: HTMLDivElement) {
    if (this.divMap) {
      console.error('MapOverlayUI already mounted')
      throw new Error('MapOverlayUI already mounted')
    }
    /* Make map div */
    this.divMap = div
    //this.divMap = document.createElement('div')
    // this.divMap.className = 'map-parent'
    // div.appendChild(this.divMap)

    this.map = window.L.map(this.divMap, {
      attributionControl: false,
      zoomControl: true,
      dragging: true,
      preferCanvas: true,
      scrollWheelZoom: true,
      fadeAnimation: false,
    })!
    this.mapRenderer = window.L.canvas({ padding: 0.5 })

    const camera = this.scene.activeCamera
    const latlng = camera ? { lat: camera.position.z / 100, lng: camera.position.x / 100 } : { lat: 0, lng: 0 }
    this.map.setView(latlng, 8)

    this.map.on('click', this.showTeleportHere)

    const tilesLayer = new window.L.TileLayer(`${process.env.MAP_URL}/tile/?z={z}&x={x}&y={y}`, {
      minZoom: 3,
      maxZoom: 15,
      attribution: 'Map data &copy; Voxels',
      id: 'Voxels',
    })
    tilesLayer.addTo(this.map)
  }

  private addAvatars() {
    if (!this.map) {
      console.warn('No map found')
      return
    }
    const markers: L.CircleMarker[] = []
    const avatarLayer = window.L.layerGroup()
    this.avatarLayer = avatarLayer

    const loadAvatarMarkers = (layer: L.LayerGroup) => {
      for (const avatar of window.connector.avatarsByUuid.values()) {
        if (!avatar.hasPosition || avatar.isUser) continue
        // small blue dot per person; canvas-rendered so hundreds stay cheap
        const marker = window.L.circleMarker(
          { lat: avatar.position.z / 100, lng: avatar.position.x / 100 },
          {
            renderer: this.mapRenderer ?? undefined,
            radius: 4,
            weight: 1,
            color: '#ffffff',
            fillColor: '#2b8cf0',
            fillOpacity: 0.9,
          },
        )
        if (avatar.name) marker.bindTooltip(avatar.name)
        markers.push(marker)
        layer.addLayer(marker)
      }
    }

    loadAvatarMarkers(avatarLayer)
    this.layerControl?.addOverlay(avatarLayer, `<i class="map-icon avatar"></i> Avatars - <small>${markers.length}</small>`)
    avatarLayer.addTo(this.map)
    this.updateAvatarTimer = setInterval(() => {
      if (!this.avatarLayer) return
      // delete all avatar markers, and rebuild them
      // this is a bit wasteful, if proves to be an issue updating existing markers is possible but a bit fiddly
      // On my machine this takes ~10ms with 200 avatars
      this.avatarLayer.clearLayers()
      while (markers.length > 0) markers.pop()?.remove()

      loadAvatarMarkers(this.avatarLayer)
    }, AVATAR_UPDATE_INTERVAL)
  }

  private async addLiveEvents() {
    // get live events and prominently display them on map!
    const live = await getLiveEvents(this.abort?.signal)
    if (!live) {
      console.warn('No live events')
      return
    }
    if (!this.map) {
      console.warn('No map found')
      return
    }

    const eventsLayer = window.L.layerGroup()
    for (const event of live) {
      const helper = new ParcelEvent(event)
      const icon = partyIcon
      const marker = window.L.marker(helper.latLng, {
        icon,
        renderer: this.mapRenderer ?? undefined,
        title: `Event live now! \r\n${helper.name}`,
      } as L.MarkerOptions)

      eventsLayer.addLayer(marker)
      marker.bindPopup(() => {
        return mapEventMarkerPopup(helper, (url: string | null) => {
          if (!url) return
          // when used with in world map
          window.persona.teleport(url)
          this.onTeleport?.()
        })
      })
    }

    // TODO event icon
    this.layerControl?.addOverlay(eventsLayer, `<i class="map-icon event"></i> Events - <small>${live.length}</small>`)
    eventsLayer.addTo(this.map)
  }

  // "you are here": a heading triangle that tracks the player live, like the minimap's arrow
  private addCurrentLocationMarker() {
    const camera = this.scene.activeCamera
    if (!camera || !this.map) {
      console.warn('No camera or map found')
      return
    }
    this.map.createPane('locationMarker')

    const icon = window.L.divIcon({ className: 'map-you-arrow', iconSize: [14, 14], iconAnchor: [7, 7] })
    this.locationMarker = window.L.marker(playerLatLng(camera), {
      icon,
      rotationOrigin: '7px 7px',
      rotationAngle: playerHeadingDeg(camera),
      pane: 'locationMarker',
      title: 'You are here!',
      interactive: false,
    } as L.MarkerOptions & { rotationOrigin: string; rotationAngle: number }).addTo(this.map)

    this.locationTimer = setInterval(() => {
      const cam = this.scene.activeCamera
      if (!cam || !this.map || !this.locationMarker) return
      this.locationMarker.setLatLng(playerLatLng(cam))
      ;(this.locationMarker as any).setRotationAngle(playerHeadingDeg(cam))
    }, 500)
  }
}

/* Add rotationAngle to markers */
let _mapPatched = false

function ensureMapPatched() {
  // Avoid mokeypatching multiple times. Currently this seems not to happen, but that depends on details like the assumption that isInspect()'s return value will not change
  if (_mapPatched) {
    return
  }

  _mapPatched = true
  // save these original methods before they are overwritten
  const proto_initIcon = (window.L.Marker.prototype as any)._initIcon
  const proto_setPos = (window.L.Marker.prototype as any)._setPos

  window.L.Marker.addInitHook(function (this: any) {
    const iconOptions = this.options.icon && this.options.icon.options
    let iconAnchor = iconOptions && this.options.icon.options.iconAnchor

    if (iconAnchor) {
      iconAnchor = iconAnchor[0] + 'px ' + iconAnchor[1] + 'px'
    }

    this.options.rotationOrigin = this.options.rotationOrigin || iconAnchor || 'center bottom'
    this.options.rotationAngle = this.options.rotationAngle || 0
  })

  window.L.Marker.include({
    _initIcon: function () {
      proto_initIcon.call(this)
    },

    _setPos: function (pos: L.Point) {
      proto_setPos.call(this, pos)
      this._applyRotation()
    },

    _applyRotation: function () {
      if (this.options.rotationAngle) {
        this._icon.style[window.L.DomUtil.TRANSFORM + 'Origin'] = this.options.rotationOrigin
        this._icon.style[window.L.DomUtil.TRANSFORM] += ' rotateZ(' + this.options.rotationAngle + 'deg)'
      }
    },

    setRotationAngle: function (angle: number) {
      this.options.rotationAngle = angle
      this.update()
      return this
    },

    setRotationOrigin: function (origin: [number, number]) {
      this.options.rotationOrigin = origin
      this.update()
      return this
    },
  })
}

const playerLatLng = (camera: BABYLON.Camera) => ({ lat: camera.position.z / 100, lng: camera.position.x / 100 })

// babylon yaw 0 faces +z, which is map north; leaflet's rotateZ turns the icon clockwise in degrees
const playerHeadingDeg = (camera: BABYLON.Camera) => (camera instanceof BABYLON.TargetCamera ? (camera.rotation.y * 180) / Math.PI : 0)

export const calculateLatLng = (parcel: MapParcelRecord) => {
  const centroid = () => {
    let x = 0
    let y = 0
    const coords = parcel.geometry.coordinates[0]

    coords.forEach((tuple: [number, number]) => {
      x += tuple[0]
      y += tuple[1]
    })

    return [x / coords.length, y / coords.length]
  }

  const center = () => {
    return parcel.x2 ? [(parcel.x2 + parcel.x1) / 200, (parcel.z2 + parcel.z1) / 200] : centroid()
  }

  return { lat: center()[1], lng: center()[0] }
}

export function SearchMap({ mapContext }: { mapContext: MapOverlayUI }) {
  const m = useRef<L.FeatureGroup | null>(null)

  const search = (value: string) => {
    if (value) {
      clearMarkers()
      const searchRegex = new RegExp(value, 'i')
      const ownerStr = (p: any) => (typeof p.owner === 'string' ? p.owner : (p.owner?.name ?? ''))
      const list = mapContext.parcels.filter((p) => p.name?.match(searchRegex) || p.label?.match(searchRegex) || p.address?.match(searchRegex) || ownerStr(p).match(searchRegex))

      m.current = window.L.featureGroup(
        list.map((p) => {
          const latlng = calculateLatLng(p)
          return window.L.marker(latlng, {
            renderer: mapContext.mapRenderer ?? undefined,
            title: p.name ?? p.address ?? '',
            interactive: false,
          } as L.MarkerOptions)
        }),
      )

      if (list.length && mapContext.map) {
        m.current.addTo(mapContext.map)
        mapContext.layerControl?.addOverlay(m.current, `<i class="map-icon avatar"></i> Search Results - <small>${list.length}</small>`)
        mapContext.map?.fitBounds(m.current.getBounds(), { maxZoom: 10 })
      }
    } else {
      clearMarkers()
    }
  }

  const clearMarkers = () => {
    if (m.current) {
      mapContext.layerControl?.removeLayer(m.current)
      m.current.remove()
    }
  }

  const onSearch = debounce(search, 800, { trailing: true, leading: false })

  return <input type="text" autoFocus placeholder={'Search...'} name="search" onInput={(e) => onSearch(e.currentTarget.value)} onClick={(e) => e.stopPropagation()} />
}

// event notification service already will have this in mem, so wasteful to fetch again
// future optimisation is to use that cache
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
    // do not re-render via diff:
    return false
  }

  componentDidMount() {
    this.map = new MapOverlayUI(this.props.scene, this.props.onTeleport)
    console.debug('Mounting BigMap')
    this.map.mount(this.div.current)
  }

  componentWillUnmount() {
    console.debug('Unmounting BigMap')
    this.map?.unmount()
    this.map?.dispose()
    this.map = null
  }

  render() {
    return <div class={BigMap.className} ref={this.div} />
  }
}
