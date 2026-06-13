import Head from './components/head'
import ReportButton from './components/report-button'
import LoadingPage from './loading-page'

import { Component } from 'preact'
import cachedFetch from '../src/helpers/cached-fetch'
import { Client } from './parcel'
import { app } from './state'
import { wompCache } from './store/index'
import { AvatarLink } from './components/avatar-link'
import { avatarName } from '../../common/messages/avatar-ref'
import { PlayButton } from './components/play-button'

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

  get visitUrl() {
    if (!this.state.womp) {
      return null
    }

    const coords = this.state.womp.coords
    return this.isSpaceWomp() ? `/spaces/${this.state.womp.space_id}/play?coords=${coords}` : `/play?coords=${coords}`
  }

  componentDidMount() {
    this.fetchWomp(this.state.id)

    if (this.visitUrl) {
      app.visitUrl.value = this.visitUrl
    }
  }

  componentWillUnmount() {
    app.visitUrl.value = undefined
  }

  async componentDidUpdate(prevProps: Props) {
    if (prevProps && prevProps.id != this.props.id) {
      const id = parseInt(this.props.id, 10)
      this.fetchWomp(id)
    }
  }

  isSpaceWomp() {
    return !!this.state.womp.space_id
  }

  async fetchWomp(id: number) {
    const r = await cachedFetch(`/api/womps/${id}.json`, {}, TTL)
    const { womp } = await r.json()

    this.setState({ womp, id })
  }

  render() {
    if (!this.state.womp.image_url) {
      return <LoadingPage />
    }

    const img = this.state.womp.image_url
    const name = this.state.womp.author ? avatarName(this.state.womp.author) : null
    const metaTitle = name ? `Captured by ${name}` : `Captured at ${this.state.womp.parcel_name || this.state.womp.space_name}`

    if (this.visitUrl) {
      app.visitUrl.value = this.visitUrl
    }

    const onZoom = () => {
      const img = document.querySelector('img.womp') as HTMLImageElement

      if (img) {
        img.requestFullscreen()
      }
    }

    return (
      <section class="columns">
        <article>
          <Head title={metaTitle} url={`/womps/${this.state.womp.id}`} description={this.state.womp.content || `This womp ${this.state.womp.id} was captured at ${this.state.womp.parcel_name || this.state.womp.space_name}`} imageURL={img}>
            <script id="womp-json" data-womp-id={this.state.womp.id} type="application/json">
              {JSON.stringify(this.state.womp)}
            </script>
          </Head>

          <h1>{this.state.womp.parcel_address}</h1>
          <figcaption>
            <PlayButton url={this.visitUrl!} />
          </figcaption>

          <figure>
            <Client parcelId={this.state.womp.parcel_id} coords={this.state.womp.coords} />
          </figure>

          {this.state.womp.content && (
            <div>
              <h3>Caption</h3>
              <p>{this.state.womp.content}</p>
            </div>
          )}
        </article>
        <aside class="push-header">
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

          <h3>Image</h3>

          <img src={img} class="womp" onClick={onZoom} />

          <ReportButton type="womps" item={this.state.womp}>
            <option value="Womp contains NSFW content">Womp contains NSFW content</option>
            <option value="Womp contains Violent content">Womp contains Violent content</option>
            <option value="Womp is making me feel uncomfortable">Womp is making me feel uncomfortable</option>
            <option value="Womp violates the rules in other ways">Womp violates the rules in other ways</option>
          </ReportButton>
        </aside>
      </section>
    )
  }
}
