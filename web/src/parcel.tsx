import { Component, createRef } from 'preact'
import Router, { route } from 'preact-router'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { canUseDom, ssrFriendlyWindow } from '../../common/helpers/utils'
import { FullParcelRecord, NearbyParcelRecord, ParcelRecord, ParcelWithMintednessRecord } from '../../common/messages/parcel'
import type { Map } from '../../vendor/library/leaflet'
import Build from './build'
import { Collaborators } from './components/collaborators'
import Listings from './components/listings'
import { PanelType } from './components/panel'
import ParcelAdminPanel from './components/parcel-admin'
import { ParcelAttributes } from './components/parcel-attributes'
import ParcelDescription from './components/parcel-description'
import ParcelEventPanel from './components/parcel-event-panel'
import WebParcelSnapshots from './components/parcel-snapshots'
import cachedFetch from './helpers/cached-fetch'
import ParcelVersions from './parcel-versions'
import Head from './components/head'
import { Spinner } from './spinner'
import { app, AppEvent } from './state'
import { fetchAPI, fetchOptions } from './utils'
import WompsList from './womps-list'
import { ParcelMetrics as Metrics } from './components/metrics'

type FrameProps = {
  src?: string
  hidden?: boolean
  parcelId?: number
  coords: string
}

type FrameState = {}

export class Client extends Component<FrameProps, FrameState> {
  div = createRef<HTMLDivElement>()
  static wrapper: HTMLDivElement | null = null
  static parcelId: number | null = null
  static instance: Client = null!

  private create() {
    if (!canUseDom) {
      return
    }

    const div = document.createElement('div')
    div.classList.add('magic-frame')

    const iframe = document.createElement('iframe')
    iframe.src = this.props.src ?? '/play'
    div.appendChild(iframe)

    const block = document.createElement('div')
    block.classList.add('block')
    block.addEventListener('click', Client.onClick)
    div.appendChild(block)

    document.body.appendChild(div)
    Client.wrapper = div
    Client.updatePosition()

    const closeButton = document.createElement('button')
    closeButton.id = 'magic-frame-close'
    closeButton.title = 'Close'
    closeButton.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      Client.dispose()
    }

    closeButton.innerHTML = 'x'

    block.appendChild(closeButton)

    // Listen for messages from the iframe

    window.addEventListener('message', (e) => {
      // const attached = Client.wrapper?.classList.contains('attached')

      const active = document.activeElement === iframe

      if (e.data.type === 'parcel') {
        const parcel = e.data.parcel as ParcelRecord
        // const path = window.location.pathname

        if (active && window.location.pathname.match(/^\/parcels\/\d+$/)) {
          route(`/parcels/${parcel.id}`, true)
        }
      }
    })
  }

  static onClick = () => {
    console.log('clicked')

    const target = document.querySelector('div.client-placeholder')

    if (target) {
      return
    }

    console.log('onClick: route to', `/parcels/${Client.parcelId}`)
    route(`/parcels/${Client.parcelId}`)
  }

  static updatePosition = () => {
    if (!Client.wrapper) {
      return
    }

    const target = document.getElementsByClassName('client-placeholder')[0] as HTMLDivElement
    const wrapper = Client.wrapper

    if (target) {
      const rect = target.getBoundingClientRect()

      wrapper.style.left = `${rect.left}px`
      wrapper.style.top = `${rect.top}px`
      wrapper.style.width = `${rect.width}px`
      wrapper.style.height = `${rect.height}px`
      wrapper.classList.add('attached')
      if (!!Client.instance?.props.hidden) {
        Client.wrapper!.style.visibility = 'hidden'
        target.style.display = 'none'
      } else {
        Client.wrapper!.style.visibility = 'visible'
        target.style.display = 'block'
      }
    } else {
      /**
       * If no target, the iframe moves to the bottom left of the screen
       */
      wrapper.style.removeProperty('left')
      wrapper.style.removeProperty('top')
      wrapper.style.removeProperty('width')
      wrapper.style.removeProperty('height')
      wrapper.classList.remove('attached')
    }

    const closeDiv = document.getElementById('magic-frame-close')
    if (closeDiv) {
      if (wrapper.classList.contains('attached')) {
        closeDiv.style.visibility = 'hidden'
      } else {
        closeDiv.style.visibility = 'visible'
      }
    }

    requestAnimationFrame(Client.updatePosition)
  }

  static dispose = () => {
    if (Client.wrapper) {
      document.body.removeChild(Client.wrapper)
      Client.wrapper = null
      Client.instance = null!
    }
  }

  constructor(props: FrameProps) {
    super(props)

    if (!Client.wrapper) {
      this.create()
      Client.instance = this
      return
    }
  }

  componentDidMount() {
    if (!Client.wrapper) {
      return
    }

    Client.parcelId = this.props.parcelId!
    console.log('#componentDidMount: Client.parcelId', Client.parcelId)

    const iframe = Client.wrapper.querySelector('iframe')!

    try {
      console.log('didMount: naviporting to', this.props.coords)
      iframe.contentWindow?.persona.naviport(this.props.coords)
    } catch (e) {
      iframe.src = `/play?coords=${this.props.coords}`
    }
  }

  componentDidUpdate(previousProps: Readonly<FrameProps>, previousState: Readonly<any>, snapshot: any): void {
    // console.log('componentDidUpdate', this.props.parcelId, previousProps.parcelId)

    if (!Client.wrapper) {
      return
    }

    const iframe = Client.wrapper.querySelector('iframe')!

    if (this.props.parcelId != Client.parcelId) {
      Client.parcelId = this.props.parcelId!
      console.log('#componentDidUpdate: Client.parcelId', Client.parcelId)

      if (document.activeElement === iframe) {
        return
      } else {
        console.log('didUpdate: naviporting to', this.props.coords)
        iframe.contentWindow?.persona.naviport(this.props.coords)
        // iframe.src = this.props.src
      }
    }
  }

  render() {
    return <div class="client-placeholder" data-src={this.props.src} ref={this.div} />
  }
}

export interface Props {
  parcel?: ParcelWithMintednessRecord
  path?: string
  id?: number
}

export interface State {
  parcel?: ParcelWithMintednessRecord | (ParcelWithMintednessRecord & FullParcelRecord)
  querying?: boolean
  price?: number
  viewTab: 'client' | 'map' | 'orbit'
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
  },
  {
    mode: 'orbit',
    label: 'Orbit',
  },
  {
    mode: 'map',
    label: 'Map',
  },
] as { mode: 'client' | 'orbit' | 'map'; label: string }[]

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
    return this.helper ? this.helper.visitUrl : undefined
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

  takeSnapshot() {
    if (!this.state.parcel) {
      console.warn('No parcel to snapshot')
      return
    }
    return fetch(`/api/parcels/snapshot`, {
      method: 'post',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parcel_id: this.state.parcelId }),
    })
      .then((r) => r.json())
      .then((r) => {
        if (!r.success) {
          app.showSnackbar('❌ Something went wrong...', PanelType.Danger)
        } else {
          app.showSnackbar('✔️ Snapshot saved!', PanelType.Success)
        }
      })
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

  setViewTab(viewTab: 'client' | 'map' | 'orbit') {
    this.setState({ viewTab })
  }

  // Do we only all the information on this parcel? (If this is
  // false we may only have a few fields from the parcel cache,

  eventCreate(parcel_event_id: number) {
    if (canUseDom && parcel_event_id) {
      window.location.href = `/events/${parcel_event_id}`
    }
  }

  onSave = () => {
    // no-op
  }

  refreshIframe() {
    // no-op
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

    const onFullscreen = () => {
      const iframe = document.querySelector('iframe') as HTMLIFrameElement
      if (iframe) {
        iframe.requestFullscreen()
      }
    }

    const iframeUrl = this.helper?.iframeUrl

    const parcelName = this.state.parcel?.name ?? this.state.parcel?.address ?? `Parcel #${this.state.parcelId}`
    const location = [this.state.parcel?.address, this.state.parcel?.suburb, this.state.parcel?.island].filter(Boolean).join(', ')
    const parcelDesc = this.state.parcel?.description
      || (location ? `${location}. The permanent exhibit of crypto art across thousands of galleries in an endlessly evolving world.` : '')
    const slug = this.state.parcel?.address?.toLowerCase().replace(/ /g, '-') ?? ''
    const ogImage = slug ? `https://map.voxels.com/parcel/${this.state.parcelId}-${slug}.png` : undefined

    return (
      <section class="columns parcel-page">
        <Head title={parcelName} description={parcelDesc} url={`/parcels/${this.state.parcelId}`} imageURL={ogImage} />
        <h1>{parcelName}</h1>

        <article>
          <figcaption>
            <button class="secondary" onClick={onFullscreen}>
              <span>Fullscreen</span>
            </button>

            {modes.map((mode) => (
              <button class={`secondary ${this.state.viewTab === mode.mode ? 'contrast' : ''}`} data-active={this.state.viewTab === mode.mode} onClick={() => this.setViewTab(mode.mode)} key={mode.mode}>
                {mode.label}
              </button>
            ))}

            <a class="buttonish" href={this.visitUrl}>
              Teleport
            </a>
          </figcaption>

          <figure>
            {this.state.viewTab === 'map' && <div className="map map-web slippy-map">&nbsp;</div>}
            {this.state.viewTab === 'orbit' && <iframe id="ParcelorbitView" src={this.helper?.orbitUrl} className="play-view" />}
            {this.state.parcel && <Client hidden={this.state.viewTab !== 'client'} parcelId={this.props.id!} src={iframeUrl} coords={this.helper!.spawnCoords} />}
          </figure>
        </article>

        <div class="postscript">
          <WompsList key={this.state.parcelId} fetch={`/womps/at/parcel/${this.state.parcelId}.json`} numberToShow={10} smaller={true} collapsed={true} />

          <Router>
            {this.isOwner && <WebParcelSnapshots parcel={this.state.parcel} path={`/parcels/${this.state.parcelId}/snapshots`} />}
            {this.isOwner && <ParcelVersions parcel={this.state.parcel} id={this.state.parcelId} onContentChange={this.refreshIframe.bind(this)} path={`/parcels/${this.props.parcel?.id ?? this.state.parcelId}/versions`} />}
          </Router>
        </div>

        <aside class="push-header">
          <Listings parcel={this.props.id!} name={this.state.parcel?.address!} />

          <dl>
            <dt>Address</dt>
            <dd>
              {this.state.parcel?.address}
              <br />
              {this.state.parcel?.suburb}
              <br />
              <a href={`/islands/${islandSlug}`}>{this.state.parcel?.island}</a>
            </dd>
          </dl>

          {this.state.parcel ? <ParcelAttributes parcel={this.state.parcel} /> : <div />}
          <a href={this.visitUrl}>Teleport</a>
          {this.state.parcel ? <Collaborators parcel={this.state.parcel} /> : <div />}
          {this.complete && this.state.parcel ? <ParcelAdminPanel parcelOrSpace={this.state.parcel as any as FullParcelRecord} onSave={this.onSave} onEventCreate={this.eventCreate.bind(this)} /> : <div />}
          <div>{this.isOwner && this.state.parcel ? <Build parcel={this.state.parcel} callback={this.refreshIframe.bind(this)} /> : <div />}</div>

          {this.state.parcel ? <ParcelEventPanel parcel={this.state.parcel} /> : <div />}

          <h3>Description</h3>

          {this.state.parcel ? <ParcelDescription parcel={this.state.parcel} path={`/parcels/${this.state.parcelId}`} /> : <div />}

          <h3>Activity</h3>

          <Metrics parcelId={this.state.parcelId} />
        </aside>
      </section>
    )
  }
}
