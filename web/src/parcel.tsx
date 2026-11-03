import { Component, Fragment, createRef } from 'preact'
import { format } from 'timeago.js'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { canUseDom } from '../../common/helpers/utils'
import { FullParcelRecord, NearbyParcelRecord, ParcelWithMintednessRecord } from '../../common/messages/parcel'
import type { VoxelsMap } from './helpers/load-voxels-map'
import { loadVoxelsMap } from './helpers/load-voxels-map'
import ParcelEvents from './components/parcel-events'
import cachedFetch, { invalidateUrl } from './helpers/cached-fetch'
import { app, AppEvent } from './state'
import { fetchOptions } from './utils'
import { AvatarLink } from './components/avatar-link'
import { ActivitySection } from './activity'
import { ParcelMetrics as Metrics } from './components/metrics'
import { getParcelIdFromPath } from './helpers/coords-nav'
import { route } from 'preact-router'
import { truncate } from './lib/string-utils'
import { readNftUrl } from '../../common/helpers/nft-url'

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
  transferring?: boolean
  transferMessage?: string
  nftifying?: boolean
  nftifyMessage?: string
}

const tabs: { id: SidebarTab; label: string }[] = [
  { id: 'about', label: 'about' },
  { id: 'map', label: 'map' },
]

export default class Parcel extends Component<Props, State> {
  map: VoxelsMap | null = null
  mapBox = createRef<HTMLDivElement>()
  uploadFile = createRef<HTMLInputElement>()

  constructor(props: Props) {
    super(props)

    this.state = {
      parcelId: props.id!,
      loading: true,
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

  // image features with a marketplace nft link the tasklet can flip to nft-image
  get nftifyCount() {
    const features = (this.state.parcel as any)?.content?.features || []
    return features.filter((f: any) => f?.type === 'image' && typeof f.link === 'string' && readNftUrl(f.link)).length
  }

  nftify = async () => {
    if (!this.isOwner || this.state.nftifying) return
    const id = this.state.parcelId
    this.setState({ nftifying: true, nftifyMessage: '' })
    try {
      const response = await cachedFetch(`/api/parcels/${id}/nftify`, { method: 'POST', credentials: 'include', cache: 'reload' })
      const result = await response.json()
      if (!result.success) throw new Error()
      if (result.changed) await invalidateUrl(`/api/parcels/${id}.json`, true)
      if (id !== this.state.parcelId) return
      this.setState({ nftifyMessage: result.conflict ? 'Parcel changed while converting. Try again.' : `Converted ${result.count} images.` })
      if (result.changed) await this.fetch(id)
    } catch {
      if (id === this.state.parcelId) this.setState({ nftifyMessage: 'Conversion failed. Try again.' })
    } finally {
      if (id === this.state.parcelId) this.setState({ nftifying: false })
    }
  }

  get canEdit() {
    return this.isOwner || (app.signedIn && this.helper?.isContributor(app.state.wallet))
  }

  get name() {
    return this.state.parcel?.name ?? this.state.parcel?.address
  }

  onAppChange = () => {
    this.forceUpdate()
  }

  download = async () => {
    if (!this.canEdit || this.state.transferring) return
    const id = this.state.parcelId
    this.setState({ transferring: true, transferMessage: '' })
    try {
      const response = await cachedFetch(`/api/parcels/${id}.json`, { cache: 'reload' })
      const data = await response.json()
      if (!data.success || !data.parcel?.content) throw new Error('Could not download parcel.')
      const content = data.parcel.content
      const url = URL.createObjectURL(new Blob([JSON.stringify({ ...content, voxels: content.voxels ?? '', features: content.features ?? [] }, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `parcel-${id}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      this.setState({ transferMessage: error instanceof Error ? error.message : 'Download failed.' })
    } finally {
      this.setState({ transferring: false })
    }
  }

  upload = async (event: Event) => {
    event.preventDefault()
    const file = this.uploadFile.current?.files?.[0]
    if (!file || !this.canEdit || this.state.transferring) return
    const id = this.state.parcelId
    this.setState({ transferring: true, transferMessage: '' })
    try {
      const data = JSON.parse(await file.text())
      const content = data?.parcel?.content ?? data?.content ?? data
      if (
        !content ||
        typeof content !== 'object' ||
        Array.isArray(content) ||
        (!('voxels' in content) && !('features' in content)) ||
        ('voxels' in content && typeof content.voxels !== 'string') ||
        ('features' in content && !Array.isArray(content.features))
      )
        throw new Error('Choose a parcel JSON file containing voxels or features.')
      if (id !== this.state.parcelId || !this.canEdit) throw new Error('Parcel changed. Choose the file again.')
      if (!confirm(`Replace the build in parcel #${id} with ${file.name}? Download a backup first if you need it.`)) return
      const response = await fetch(`/grid/parcels/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { ...content, voxels: content.voxels ?? '', features: content.features ?? [] } }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Parcel upload failed.')
      if (this.uploadFile.current) this.uploadFile.current.value = ''
      this.setState({ transferMessage: `Uploaded to parcel #${id}.` })
      await invalidateUrl(`/api/parcels/${id}.json`)
    } catch (error) {
      this.setState({ transferMessage: error instanceof Error ? error.message : 'Upload failed.' })
    } finally {
      this.setState({ transferring: false })
    }
  }

  onUrl = () => {
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
    window.addEventListener('parcelchange', this.onUrl)
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    this.syncVisitUrl()
    if (this.props.id != this.state.parcelId) {
      void this.fetch(this.props.id!)
    }

    if (this.state.tab === 'map' && prevState.tab !== 'map' && this.state.parcel && !this.map) {
      setTimeout(() => this.addMap(), 50)
    }

    if (this.state.tab === 'map' && this.map && prevState.parcel?.id !== this.state.parcel?.id) {
      this.updateMapParcel()
    }

    if (this.state.tab !== 'map' && this.map) {
      this.map.dispose()
      this.map = null
    }
  }

  componentWillUnmount() {
    app.visitUrl.value = undefined
    this.map?.dispose()
    this.map = null

    window.removeEventListener('parcelchange', this.onUrl)

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
    const p = this.state.parcel
    this.map.setView((p.x1 + p.x2) / 2, (p.z1 + p.z2) / 2, 200)
  }

  async addMap() {
    if (!canUseDom || !this.state.parcel) {
      return
    }

    const mapElem = this.mapBox.current
    if (!mapElem) {
      return
    }

    mapElem.innerHTML = ''
    mapElem.style.position = 'relative'
    const canvas = document.createElement('canvas')
    canvas.className = 'voxels-map'
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none'
    mapElem.appendChild(canvas)

    const p = this.state.parcel
    const { VoxelsMap } = await loadVoxelsMap()
    this.map = new VoxelsMap(canvas, { ortho: 200, parcels: true })
    this.map.setView((p.x1 + p.x2) / 2, (p.z1 + p.z2) / 2, 200)
    this.map.load().catch((e) => console.error('parcel map load failed', e))
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
    if (!this.state.parcel) {
      return null
    }

    const p = this.state.parcel
    const h = this.helper!
    const attrs: string[] = []
    if (p.y1 < 0) attrs.push('Basement')
    if (h.isWaterFront) attrs.push('Waterfront')
    if (p.kind == 'inner') attrs.push('Prebuilt')
    const updated = 'updated_at' in p && typeof p.updated_at === 'string' ? format(Date.parse(p.updated_at as string)) : ''

    return (
      <>
        <div class="parcel-actions">
          {this.canEdit && (
            <a
              href={`/parcels/${this.state.parcelId}/edit`}
              class="buttonish"
              onClick={(e) => {
                e.preventDefault()
                route(`/parcels/${this.state.parcelId}/edit`)
              }}
            >
              Edit
            </a>
          )}
          <button type="button" disabled={this.state.querying} onClick={() => this.updateStateFromBlockChain()}>
            {this.state.querying ? 'Refreshing...' : 'Refresh ownership'}
          </button>
        </div>
        {this.state.parcel?.description && (
          <details class="inspector-section parcel-description" key={p.id}>
            <summary>description</summary>
            <p>
              {this.state.parcel.description.split('\n').map((line: string, i: number, arr: string[]) => (
                <Fragment key={i}>
                  {line}
                  {i < arr.length - 1 && <br />}
                </Fragment>
              ))}
            </p>
          </details>
        )}
        <h3>properties</h3>
        <dl class="parcel-properties">
          <dt>Address</dt>
          <dd>
            {p.address}
            {p.suburb && <div>{p.suburb}</div>}
            <div>
              <a href={`/islands/${islandSlug}`}>{p.island}</a>
            </div>
          </dd>
          <dt>Owner</dt>
          <dd>
            <AvatarLink avatar={p.owner} />
          </dd>
          <dt>Token</dt>
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
            {h.width} &times; {h.depth} &times; {h.height} m
          </dd>
          {p.y1 > 0 ? (
            <Fragment>
              <dt>Elevation</dt>
              <dd>{p.y1} m</dd>
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

        {this.state.parcel?.parcel_users && this.state.parcel.parcel_users.length > 0 && (
          <details class="inspector-section">
            <summary>collaborators</summary>
            <ul>
              {this.state.parcel.parcel_users.map((u: any) => (
                <li key={u.owner}>
                  <AvatarLink avatar={u} />
                </li>
              ))}
            </ul>
          </details>
        )}
        {this.state.parcel ? <ParcelEvents parcel={this.state.parcel} /> : null}

        {this.isOwner && this.nftifyCount > 0 && (
          <div class="f">
            <label>tasklets</label>
            <button type="button" disabled={this.state.nftifying} onClick={this.nftify}>
              {this.state.nftifying ? 'converting...' : `auto-convert ${this.nftifyCount} images to nft-images`}
            </button>
            {this.state.nftifyMessage && <p role="status">{this.state.nftifyMessage}</p>}
          </div>
        )}

        {this.canEdit && (
          <details class="inspector-section">
            <summary>parcel download / upload</summary>
            <form key={this.state.parcelId} onSubmit={this.upload}>
              <p>Download the build as JSON, or upload a build to replace it.</p>
              <button type="button" disabled={this.state.transferring} onClick={this.download}>
                Download JSON
              </button>
              <div class="f">
                <label htmlFor="parcel-upload">Parcel JSON</label>
                <input id="parcel-upload" ref={this.uploadFile} type="file" accept=".json,application/json" required disabled={this.state.transferring} />
              </div>
              <button type="submit" disabled={this.state.transferring}>
                Upload JSON
              </button>
              {this.state.transferMessage && <p role="status">{this.state.transferMessage}</p>}
            </form>
          </details>
        )}

        <ActivitySection parcelId={this.state.parcelId} />
        <details class="inspector-section">
          <summary>metrics</summary>
          <Metrics parcelId={this.state.parcelId} />
        </details>
      </>
    )
  }

  renderSidebar(islandSlug: string) {
    const { tab } = this.state

    return (
      <>
        <ul class="sidebar-tabs">
          {tabs.map((t) => (
            <li key={t.id}>
              <button type="button" class={tab === t.id ? 'selected' : ''} aria-pressed={tab === t.id} onClick={() => this.setTab(t.id)}>
                {t.label}
              </button>
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

    return (
      <section class="parcel-page">
        <h1>{parcelName}</h1>
        {parcelName !== this.state.parcel.address && <p class="parcel-address">{this.state.parcel.address}</p>}

        {this.renderSidebar(islandSlug!)}
      </section>
    )
  }
}
