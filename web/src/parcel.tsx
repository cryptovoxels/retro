import { Component, Fragment, createRef } from 'preact'
import { format } from 'timeago.js'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { canUseDom } from '../../common/helpers/utils'
import { FullParcelRecord, NearbyParcelRecord, ParcelWithMintednessRecord } from '../../common/messages/parcel'
import type { Map } from '../../vendor/library/leaflet'
import ParcelEvents from './components/parcel-events'
import cachedFetch from './helpers/cached-fetch'
import Head from './components/head'
import { app, AppEvent } from './state'
import { fetchOptions } from './utils'
import { AvatarLink } from './components/avatar-link'
import { ParcelMetrics as Metrics } from './components/metrics'
import { Client } from './client'
import { isSplit, getParcelIdFromPath, routeWithCoords, withCoords } from './helpers/coords-nav'

export interface Props {
  parcel?: ParcelWithMintednessRecord
  path?: string
  id?: number
}

type SidebarTab = 'about' | 'map'

export interface State {
  parcel?: ParcelWithMintednessRecord | (ParcelWithMintednessRecord & FullParcelRecord)
  querying?: boolean
  nearby?: NearbyParcelRecord[]
  loading: boolean
  parcelId: number
  tab: SidebarTab
}

const tabs: { id: SidebarTab; label: string }[] = [
  { id: 'about', label: 'about' },
  { id: 'map', label: 'map' },
]

const parcelMapStyle = {
  color: '#333333',
  opacity: 1.0,
  fillColor: '#ffffff',
  fillOpacity: 0.5,
  dashArray: '5,5',
  weight: 4,
}

export default class Parcel extends Component<Props, State> {
  map: Map | null = null
  parcelLayer: any = null
  mapBox = createRef<HTMLDivElement>()

  constructor(props: Props) {
    super(props)

    const parcel = props.parcel ?? null

    this.state = {
      parcelId: props.id!,
      parcel: parcel ?? undefined,
      loading: !parcel,
      nearby: [],
      tab: 'about',
    }
  }

  get helper() {
    if (!this.state.parcel) {
      return undefined
    }

    return new ParcelHelper(this.state.parcel)
  }

  // the world this parcel lives in, so the header Play button enters it
  get visitUrl() {
    return this.helper ? `/play?coords=${this.helper.spawnCoords}` : undefined
  }

  syncVisitUrl() {
    if (this.visitUrl) app.visitUrl.value = this.visitUrl
  }

  get isOwner() {
    if (!app.signedIn) {
      return false
    }

    return this.state.parcel && this.helper?.isOwner(app.state.wallet)
  }

  get name() {
    return this.state.parcel?.name ?? this.state.parcel?.address
  }

  onAppChange = () => {
    this.forceUpdate()
  }

  onUrl = () => {
    if (!isSplit()) return
    const id = getParcelIdFromPath()
    if (!id || id === this.state.parcelId) return
    void this.fetch(id)
  }

  abort: AbortController | null = null

  async fetch(parcelId: number) {
    this.abort?.abort('ABORT:Parcel changed...')

    this.abort = new AbortController()
    if (!this.state.parcel) {
      this.setState({ loading: true })
    }

    const url = `/api/parcels/${parcelId}.json`

    try {
      var f = await cachedFetch(url, { signal: this.abort.signal })
    } catch (e) {
      console.error('Fetch aborted', e)
      if (!this.state.parcel) {
        this.setState({ loading: false })
      }
      return
    }
    const { parcel } = await f.json()

    this.setState({ parcel, parcelId, nearby: [], loading: false })
    this.abort = null
  }

  componentDidMount() {
    this.syncVisitUrl()
    void this.fetch(this.props.id!)

    if (history) {
      history.pushState = (history as any)['oldPushState']
    }
    app.on(AppEvent.Change, this.onAppChange)
    if (isSplit()) {
      window.addEventListener('parcelchange', this.onUrl)
    }
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    this.syncVisitUrl()
    if (!isSplit() && this.props.id != this.state.parcelId) {
      void this.fetch(this.props.id!)
    }

    if (this.state.tab === 'map' && prevState.tab !== 'map' && this.state.parcel && !this.map) {
      setTimeout(() => this.addMap(), 50)
    }

    if (this.state.tab === 'map' && this.map && prevState.parcel?.id !== this.state.parcel?.id) {
      this.updateMapParcel()
    }

    if (this.state.tab !== 'map' && this.map) {
      this.map.remove()
      this.map = null
      this.parcelLayer = null
    }
  }

  componentWillUnmount() {
    app.visitUrl.value = undefined
    this.map?.remove()
    this.map = null
    this.parcelLayer = null

    if (isSplit()) {
      window.removeEventListener('parcelchange', this.onUrl)
    }

    history.pushState = function () {
      ;(history as any)['oldPushState'].apply(this, arguments as any)
      scrollTo(0, 0)
    }
    app.removeListener(AppEvent.Change, this.onAppChange)
  }

  updateMapParcel() {
    if (!this.map || !this.state.parcel) {
      return
    }

    this.map.setView(this.helper!.latLng, 10)
    this.parcelLayer?.remove()
    this.parcelLayer = window.L.geoJSON([this.state.parcel.geometry], { style: parcelMapStyle }).addTo(this.map)
  }

  addMap() {
    if (!canUseDom || !this.state.parcel) {
      return
    }

    const mapElem = this.mapBox.current
    if (!mapElem) {
      return
    }

    this.map = window.L.map(mapElem, { scrollWheelZoom: false }).setView(this.helper!.latLng, 10)
    window.L.tileLayer(`${process.env.MAP_URL}/tile/?z={z}&x={x}&y={y}`, {
      minZoom: 5,
      maxZoom: 20,
      attribution: 'Map data &copy; Voxels',
      id: 'Voxels',
    }).addTo(this.map)

    this.parcelLayer = window.L.geoJSON([this.state.parcel.geometry], { style: parcelMapStyle }).addTo(this.map)
  }

  setTab(tab: SidebarTab) {
    this.setState({ tab })
  }

  updateStateFromBlockChain() {
    if (this.state.querying) {
      return
    }
    this.setState({ querying: true })
    return fetch(`/api/parcels/${this.state.parcelId}/query`, fetchOptions())
      .then((r) => r.json())
      .then(() => {
        window.location.reload()
      })
      .catch((e) => {
        console.error(e)
        this.setState({ querying: false })
      })
  }

  renderAbout(islandSlug: string) {
    return (
      <>
        {this.state.parcel &&
          (() => {
            const p = this.state.parcel
            const h = this.helper!
            const attrs: string[] = []
            if (p.y1 < 0) attrs.push('Basement')
            if (h.isWaterFront) attrs.push('Waterfront')
            if (p.kind == 'inner') attrs.push('Prebuilt')
            const updated = 'updated_at' in p && typeof p.updated_at === 'string' ? format(Date.parse(p.updated_at as string)) : ''
            return (
              <dl>
                <dt>Address</dt>
                <dd>
                  {p.address}
                  <br />
                  {p.suburb}
                  <br />
                  <a href={`/islands/${islandSlug}`}>{p.island}</a>
                </dd>
                <dt>Owner</dt>
                <dd>
                  <AvatarLink avatar={p.owner} />
                </dd>
                <dt>Token ID</dt>
                <dd>
                  <a href={h.tokenUri}>#{p.id}</a>
                </dd>
                {(p as any).traffic_visits ? (
                  <Fragment>
                    <dt>Visits</dt>
                    <dd>{(p as any).traffic_visits.toLocaleString()}</dd>
                  </Fragment>
                ) : null}
                <dt>Dimensions</dt>
                <dd>
                  {h.width}m &times; {h.depth}m and {h.height}m tall.
                </dd>
                {p.y1 > 0 ? (
                  <Fragment>
                    <dt>Elevation</dt>
                    <dd>{p.y1}m.</dd>
                  </Fragment>
                ) : null}
                {attrs.length > 0 ? (
                  <Fragment>
                    <dt>Attributes</dt>
                    <dd>{attrs.join(', ')}</dd>
                  </Fragment>
                ) : null}
                {h.isSandbox ? (
                  <Fragment>
                    <dt>Sandbox</dt>
                    <dd>Yes</dd>
                  </Fragment>
                ) : null}
                {updated ? (
                  <Fragment>
                    <dt>Updated</dt>
                    <dd>{updated}</dd>
                  </Fragment>
                ) : null}
              </dl>
            )
          })()}

        {this.isOwner && (
          <a
            href={withCoords(`/parcels/${this.state.parcelId}/edit`)}
            onClick={(e) => {
              e.preventDefault()
              routeWithCoords(`/parcels/${this.state.parcelId}/edit`)
            }}
          >
            Edit
          </a>
        )}

        {this.state.parcel ? (
          <p title="Refresh owner and parcel state from the chain (e.g. after an OpenSea sale)">
            {this.state.querying ? (
              <span>🐙 Update</span>
            ) : (
              <button type="button" onClick={() => this.updateStateFromBlockChain()}>
                🦑 Update
              </button>
            )}
          </p>
        ) : null}

        {this.state.parcel?.parcel_users && this.state.parcel.parcel_users.length > 0 && (
          <div>
            <h3>Collaborators</h3>
            <ul>
              {this.state.parcel.parcel_users.map((u: any) => (
                <li key={u.wallet}>
                  <AvatarLink avatar={u} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {this.state.parcel ? <ParcelEvents parcel={this.state.parcel} /> : null}

        {this.state.parcel?.description && (
          <div>
            <h3>Description</h3>
            <p>
              {this.state.parcel.description.split('\n').map((line: string, i: number, arr: string[]) => (
                <Fragment key={i}>
                  {line}
                  {i < arr.length - 1 && <br />}
                </Fragment>
              ))}
            </p>
          </div>
        )}

        <h3>Activity</h3>
        <Metrics parcelId={this.state.parcelId} />
      </>
    )
  }

  renderSidebar(islandSlug: string) {
    const { tab } = this.state

    return (
      <>
        <ul class="sidebar-tabs">
          {tabs.map((t) => (
            <li key={t.id} class={tab === t.id ? '-active' : ''} onClick={() => this.setTab(t.id)}>
              {t.label}
            </li>
          ))}
        </ul>

        {tab === 'about' && this.renderAbout(islandSlug)}
        {tab === 'map' && <div class="map map-web parcel-sidebar-map" ref={this.mapBox} />}
      </>
    )
  }

  render() {
    if (!this.state.parcel || !this.helper) {
      return null
    }

    const islandSlug = this.state.parcel.island?.toLowerCase().replace(/\s+/, '-')
    const parcelName = this.state.parcel.name ?? this.state.parcel.address ?? `Parcel #${this.state.parcelId}`
    const location = [this.state.parcel.address, this.state.parcel.suburb, this.state.parcel.island].filter(Boolean).join(', ')
    const parcelDesc = this.state.parcel.description || (location ? `${location}. The permanent exhibit of crypto art across thousands of galleries in an endlessly evolving world.` : '')
    const slug = this.state.parcel.address?.toLowerCase().replace(/ /g, '-') ?? ''
    const ogImage = slug ? `https://map.voxels.com/parcel/${this.state.parcelId}-${slug}.png` : undefined

    const head = <Head title={parcelName} description={parcelDesc} url={`/parcels/${this.state.parcelId}`} imageURL={ogImage} />

    if (isSplit()) {
      return (
        <>
          {head}
          {this.renderSidebar(islandSlug!)}
        </>
      )
    }

    return (
      <section class="columns parcel-page">
        <article>
          {head}
          <Client coords={this.helper.spawnCoords} />
        </article>
        <aside>{this.renderSidebar(islandSlug!)}</aside>
      </section>
    )
  }
}
