import Head from './components/head'
import ReportButton from './components/report-button'
import LoadingPage from './loading-page'

import { Component } from 'preact'
import cachedFetch from '../src/helpers/cached-fetch'
import { wompCache } from './store/index'
import { AvatarLink } from './components/avatar-link'
import { avatarName } from '../../common/messages/avatar-ref'
import { Client } from './client'
import { isSplit } from './helpers/coords-nav'
import { app } from './state'

const TTL = 60

export interface Props {
  womp?: any
  id?: any
  path?: any
}

export interface State {
  id: number
  womp?: any
}

export default class Womp extends Component<Props, State> {
  constructor(props: Props) {
    super(props)

    let womp: any

    const cache = wompCache.get(`/womps/${props.id}`)

    if (props.womp) {
      womp = props.womp
    } else if (cache) {
      womp = cache
    } else {
      womp = { id: props.id }
    }

    const id = parseInt(props.id, 10)

    this.state = {
      id: id,
      womp: womp,
    }
  }

  get wompLoaded() {
    return this.state.womp.image_url
  }

  componentDidMount() {
    this.syncVisitUrl()
    void this.fetchWomp(this.state.id)
  }

  async componentDidUpdate(prevProps: Props) {
    this.syncVisitUrl()
    if (prevProps && prevProps.id != this.props.id) {
      const id = parseInt(this.props.id, 10)
      this.fetchWomp(id)
    }
  }

  componentWillUnmount() {
    app.visitUrl.value = undefined
  }

  // the world this womp was shot in, so the header Play button enters it
  get visitUrl() {
    const coords = this.state.womp?.coords
    if (!coords) return undefined
    return this.isSpaceWomp() ? `/spaces/${this.state.womp.space_id}/play?coords=${coords}` : `/play?coords=${coords}`
  }

  syncVisitUrl() {
    if (this.visitUrl) app.visitUrl.value = this.visitUrl
  }

  isSpaceWomp() {
    return !!this.state.womp.space_id
  }

  async fetchWomp(id: number) {
    const r = await cachedFetch(`/api/womps/${id}.json`, {}, TTL)
    const { womp } = await r.json()

    this.setState({ womp, id })
  }

  renderAside(img: string) {
    const onZoom = () => {
      const el = document.querySelector('img.womp') as HTMLImageElement
      if (el) el.requestFullscreen()
    }

    return (
      <>
        <dl>
          <dt>Womp ID</dt>
          <dd>{this.props.id}</dd>
          <dt>Photographer</dt>
          <dd>
            <AvatarLink avatar={this.state.womp.author} />
          </dd>
          <dt>{!this.isSpaceWomp() ? `Parcel` : `Space`}</dt>
          <dd>
            <a href={!this.isSpaceWomp() ? `/parcels/${this.state.womp.parcel_id}` : `/spaces/${this.state.womp.space_id}`}>{this.state.womp.parcel_name || this.state.womp.space_name}</a>
          </dd>
          <dt>Created at</dt>
          <dd>{new Date(this.state.womp.created_at).toLocaleString()}</dd>
        </dl>

        <img src={img} class="womp" onClick={onZoom} />

        {this.state.womp.content && <p>{this.state.womp.content}</p>}

        <ReportButton type="womps" item={this.state.womp}>
          <option value="Womp contains NSFW content">Womp contains NSFW content</option>
          <option value="Womp contains Violent content">Womp contains Violent content</option>
          <option value="Womp is making me feel uncomfortable">Womp is making me feel uncomfortable</option>
          <option value="Womp violates the rules in other ways">Womp violates the rules in other ways</option>
        </ReportButton>
      </>
    )
  }

  render() {
    if (!this.state.womp.image_url) {
      return <LoadingPage />
    }

    const img = this.state.womp.image_url
    const name = this.state.womp.author ? avatarName(this.state.womp.author) : null
    const metaTitle = name ? `Captured by ${name}` : `Captured at ${this.state.womp.parcel_name || this.state.womp.space_name}`

    const head = (
      <Head title={metaTitle} url={`/womps/${this.state.womp.id}`} description={this.state.womp.content || `This womp ${this.state.womp.id} was captured at ${this.state.womp.parcel_name || this.state.womp.space_name}`} imageURL={img}>
        <script id="womp-json" data-womp-id={this.state.womp.id} type="application/json">
          {JSON.stringify(this.state.womp)}
        </script>
      </Head>
    )

    if (isSplit()) {
      return (
        <>
          {head}
          {this.renderAside(img)}
        </>
      )
    }

    return (
      <section class="columns">
        <article>
          {head}
          <Client coords={this.state.womp.coords} />
        </article>
        <aside>{this.renderAside(img)}</aside>
      </section>
    )
  }
}
