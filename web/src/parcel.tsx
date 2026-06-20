import { Component, Fragment, createRef } from 'preact'
import { route } from 'preact-router'
import { format } from 'timeago.js'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { canUseDom, ssrFriendlyWindow } from '../../common/helpers/utils'
import { FullParcelRecord, NearbyParcelRecord, ParcelRecord, ParcelWithMintednessRecord } from '../../common/messages/parcel'
import type { Map } from '../../vendor/library/leaflet'
import ParcelEvents from './components/parcel-events'
import cachedFetch from './helpers/cached-fetch'
import Head from './components/head'
import { Spinner } from './spinner'
import { app, AppEvent } from './state'
import { fetchOptions } from './utils'
import WompsList from './womps-list'
import { AvatarLink } from './components/avatar-link'
import { ParcelMetrics as Metrics } from './components/metrics'
import { PlayButton } from './components/play-button'
import { Client } from './client'

export interface Props {
  parcel?: ParcelWithMintednessRecord
  path?: string
  id?: number
}

export interface State {
  parcel?: ParcelWithMintednessRecord | (ParcelWithMintednessRecord & FullParcelRecord)
  querying?: boolean
  price?: number
  viewTab: 'client' | 'map'
  nearby?: NearbyParcelRecord[]
  loading: boolean
  parcelId: number
}

const ParcelThumb = (props: { parcel: NearbyParcelRecord }) => {
  const helper = new ParcelHelper(props.parcel)
  const name = props.parcel.name ?? props.parcel.address
  const address = (props.parcel.name ? [props.parcel.address, props.parcel.suburb] : [props.parcel.suburb]).join(', ')

  return (
    <li>
      <a href={`/parcels/${props.parcel.id}`}>{name}</a>
      <br />
      {address}
    </li>
  )
}

const modes = [
  {
    mode: 'client',
    label: 'Explore',
    short: 'E',
  },
  {
    mode: 'map',
    label: 'Map',
    short: 'M',
  },
] as { mode: 'client' | 'map'; label: string; short: string }[]

export default class Parcel extends Component<Props, State> {
  map: Map | null = null
  iframe = createRef()

  constructor(props: Props) {
    super(props)

    const parcel = props.parcel ?? null

    this.state = {
      parcelId: props.id!,
      parcel: parcel ?? undefined,
      loading: !parcel,
      nearby: [],
      viewTab: 'client',
    }
  }

  get helper() {
    if (!this.state.parcel) {
      return undefined
    }

    return new ParcelHelper(this.state.parcel)
  }

  get isOwner() {
    if (!app.signedIn) {
      return false
    }

    return this.state.parcel && this.helper?.isOwner(app.state.wallet)
  }

  get isCollaborator() {
    if (!app.signedIn) {
      return false
    }
    return this.state.parcel && this.helper?.isContributor(app.state.wallet)
  }

  get visitUrl() {
    return this.helper ? this.helper.iframeUrl : undefined
  }

  get name() {
    return this.state.parcel?.name ?? this.state.parcel?.address
  }

  get address() {
    return this.state.parcel?.name ? this.state.parcel?.address : this.state.parcel?.suburb
  }

  get originCity() {
    return this.state.parcel?.island === 'Origin City'
  }

  // and are still loading)
  get complete() {
    return this.state.parcel?.settings
  }

  onAppChange = () => {
    this.forceUpdate()
  }

  abort: AbortController | null = null

  async fetch(parcelId: number) {
    this.abort?.abort('ABORT:Parcel changed...')

    this.abort = new AbortController()

    this.setState({ parcelId })

    const url = `/api/parcels/${parcelId}.json`

    this.setState({ loading: true })

    try {
      var f = await cachedFetch(url, { signal: this.abort.signal })
    } catch (e) {
      console.error('Fetch aborted', e)
      this.setState({ loading: false })
      return
    }
    const { parcel } = await f.json()
    console.log('parcel', parcel)

    this.setState({ parcel, nearby: [], loading: false })

    this.abort = null
  }

  componentDidMount() {
    this.fetch(this.props.id!)

    if (history) {
      // this history pushstate in main.tsx is overwritten to scroll to top all the time.
      // we overwrite this here to avoid the scroll to top on tab changes
      history.pushState = (history as any)['oldPushState']
    }
    app.on(AppEvent.Change, this.onAppChange)

    if (this.visitUrl) {
      app.visitUrl.value = this.visitUrl
    }
  }

  load(parcelId: number) {
    this.fetch(parcelId)
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props.id != this.state.parcelId) {
      this.fetch(this.props.id!)
    }
  }

  componentWillUnmount() {
    app.visitUrl.value = undefined

    // Reset the pushState to include the scroll to top
    history.pushState = function () {
      ;(history as any)['oldPushState'].apply(this, arguments as any)
      scrollTo(0, 0)
    }
    app.removeListener(AppEvent.Change, this.onAppChange)
  }

  addMap() {
    if (!canUseDom || !this.state.parcel) {
      return
    }

    const mapElem: HTMLElement | null = document.querySelector('.slippy-map')

    if (!mapElem) {
      console.error('No map element found, cannot add map')
      return
    }

    this.map = window.L.map(mapElem, { scrollWheelZoom: false }).setView(this.helper!.latLng, 10)
    window.L.tileLayer(`${process.env.MAP_URL}/tile/?z={z}&x={x}&y={y}`, {
      minZoom: 5,
      maxZoom: 20,
      attribution: 'Map data &copy; Voxels',
      id: 'Voxels',
    }).addTo(this.map)

    const style = {
      color: '#333333',
      opacity: 1.0,
      fillColor: '#ffffff',
      fillOpacity: 0.5,
      dashArray: '5,5',
      weight: 4,
    }

    window.L.geoJSON([this.state.parcel.geometry], { style }).addTo(this.map)
  }

  setViewTab(viewTab: 'client' | 'map') {
    this.setState({ viewTab })
  }

  // Do we only all the information on this parcel? (If this is
  // false we may only have a few fields from the parcel cache,

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

  render() {
    if (!this.map && this.state.viewTab == 'map' && ssrFriendlyWindow && ssrFriendlyWindow['addEventListener']) {
      setTimeout(() => this.addMap(), 50)
    }

    if (this.state.viewTab !== 'map') {
      this.map = null
    }

    const islandSlug = this.state.parcel?.island?.toLowerCase().replace(/\s+/, '-')
    const nearby = this.state.nearby?.slice(0, 5).map((p) => <ParcelThumb key={p.id} parcel={p} />)

    const parcelName = this.state.parcel?.name ?? this.state.parcel?.address ?? `Parcel #${this.state.parcelId}`
    const location = [this.state.parcel?.address, this.state.parcel?.suburb, this.state.parcel?.island].filter(Boolean).join(', ')
    const parcelDesc = this.state.parcel?.description || (location ? `${location}. The permanent exhibit of crypto art across thousands of galleries in an endlessly evolving world.` : '')
    const slug = this.state.parcel?.address?.toLowerCase().replace(/ /g, '-') ?? ''
    const ogImage = slug ? `https://map.voxels.com/parcel/${this.state.parcelId}-${slug}.png` : undefined

    return (
      <section class="columns parcel-page">
        <article>
          <Head title={parcelName} description={parcelDesc} url={`/parcels/${this.state.parcelId}`} imageURL={ogImage} />
          <div class="parcel-head">
            <h1>{parcelName}</h1>
            <figcaption>
              {modes.map((mode) => (
                <button class={`secondary ${this.state.viewTab === mode.mode ? 'contrast' : ''}`} data-active={this.state.viewTab === mode.mode} onClick={() => this.setViewTab(mode.mode)} key={mode.mode}>
                  <span class="mode-full">{mode.label}</span>
                  <span class="mode-short">{mode.short}</span>
                </button>
              ))}

              {this.isOwner && (
                <a class="buttonish" href={`/parcels/${this.state.parcelId}/edit`}>
                  Edit
                </a>
              )}

              {this.helper && <PlayButton url={this.helper.iframeUrl} />}
            </figcaption>
          </div>

          <figure>
            {this.state.viewTab === 'map' && <div className="map map-web slippy-map">&nbsp;</div>}
            {this.state.parcel && this.state.viewTab === 'client' && <Client parcelId={this.props.id!} coords={this.helper!.spawnCoords} />}
          </figure>
          <WompsList key={this.state.parcelId} fetch={`/womps/at/parcel/${this.state.parcelId}.json`} numberToShow={10} smaller={true} collapsed={true} />
        </article>

        <aside>
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
        </aside>
      </section>
    )
  }
}
