import { Component } from 'preact'
import EditableName from './components/Editable/editable-name'
import { fetchOptions } from './utils'
import { app } from './state'
import { AssetType } from './components/Editable/editable'
import SpaceHelper from './space-helper'
import EditableDescription from './components/Editable/editable-description'
import { copyTextToClipboard, ssrFriendlyDocument } from '../../common/helpers/utils'
import WompsList from './womps-list'
import LoadingIcon from './components/loading-icon'
import ParcelAdminPanel from './components/parcel-admin'
import { SpaceRecord } from '../../common/messages/space'
import Head from './components/head'

export function PlayButton(props: { url: string }) {
  return <a href={props.url}>Visit</a>
}

export interface Props {
  space?: SpaceRecord
  path?: string
  id?: number
}

export interface State {
  space: SpaceRecord | null
  slug?: string
  error: string | null
  querying?: boolean
  parcelTab?: any
}

export default class Space extends Component<Props, State> {
  map: any
  iframe: HTMLIFrameElement = undefined!

  constructor(props: Props) {
    super()

    const d = ssrFriendlyDocument?.querySelector && ssrFriendlyDocument?.querySelector('#space-json')
    let space: SpaceRecord | null = null

    if (d && parseInt(d!.getAttribute('data-space-id')!, 10) == props.id) {
      space = JSON.parse(d!.getAttribute('value')!)
    } else if (props.space) {
      space = props.space ?? null
    }

    this.state = {
      space,
      slug: '',
      error: null,
      parcelTab: 'description',
    }
  }

  get helper() {
    if (!this.state.space) {
      return null
    }

    return new SpaceHelper(this.state.space)
  }

  get isOwner() {
    if (!app.signedIn) {
      return false
    }
    return !!this.state.space && this.state.space.owner.toLowerCase() === app.state.wallet?.toLowerCase()
  }

  get visitUrl() {
    return this.helper?.visitUrl
  }

  get name() {
    return this.state.space?.name || this.state.space?.id || ''
  }

  get hasSlug() {
    return !!this.state.space && this.state.slug !== this.state.space.id
  }

  componentDidMount() {
    this.fetch()

    app.visitUrl.value = this.visitUrl
  }

  componentWillUnmount() {
    app.visitUrl.value = undefined
  }

  fetch() {
    let url = `${process.env.API}/spaces/${this.props.id}.json`

    if (this.isOwner) {
      // Cache bust fetching of page if you are the owner of the parcel
      // (this owner state will be from last cache, so won't update if the parcel has just been transferred
      // to you but it will improve experience when refreshing to make sure your changes have stuck)
      url += `?${Date.now()}`
    }

    fetch(url, fetchOptions())
      .then((r) => r.json())
      .then((r) => {
        this.setState({
          space: Object.assign({}, this.props.space, r.space, { spaceId: r.space.id }),
          slug: r.space.slug || r.space.id,
        })
      })
  }

  componentDidUpdate(props: any) {
    if (props.id != this.props.id) {
      this.fetch()
    }
  }

  refreshIframe() {
    if (!this.iframe) {
      return
    }
    this.iframe.src += `&nonce=${Math.random()}`
    this.fetch()
  }

  switchTab(tab: string) {
    this.setState({ parcelTab: tab })
  }

  setSlug(slug: string) {
    const s = slug
      .replace(' ', '')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/#|_|<|>|\[|\]|{|}|\^|%|&|\?/g, '')
      .toLowerCase()
    this.setState({ slug: s })
  }

  copyToClipboard = (e: any) => {
    copyTextToClipboard(
      e.target.value,
      () => {
        app.showSnackbar('Link copied !')
      },
      () => {
        app.showSnackbar('Could not copy')
      },
    )
  }

  render() {
    const space = this.state.space
    if (!space) {
      return (
        <section>
          <LoadingIcon />
        </section>
      )
    }

    app.visitUrl.value = this.visitUrl

    return (
      <section class="columns">
        <EditableName value={space.name} path={this.props.path} isowner={this.isOwner} type={AssetType.Space} data={this.state.space} title="Name of this space" />

        <article>
          <Head title={this.name} description={space.description ?? `Visit this space`} url={`/spaces/${space.id}`}>
            <script id="space-json" data-space-id={space.id} type="application/json">
              {JSON.stringify(this.props.space)}
            </script>
          </Head>

          <figcaption>
            <PlayButton url={this.helper!.visitUrl} />
          </figcaption>

          <figure>
            <iframe
              id="ParcelorbitView"
              ref={(c) => {
                this.iframe = c!
              }}
              scrolling="no"
              src={this.helper?.orbitUrl}
            />
          </figure>

          {(this.isOwner && (
            <div>
              <EditableDescription value={space.description} isowner={this.isOwner} type={AssetType.Space} data={this.state.space} title="Description of this space" />
            </div>
          )) ||
            space.description}
        </article>
        <div class="postscript">
          <h3>Womps</h3>

          <WompsList fetch={`/womps/at/space/${space.spaceId}.json`} />
        </div>
        <aside class="push-header">
          <dl>
            <dt>Type</dt>
            <dd>Space</dd>
            <dt>Owner</dt>
            <dd>{this.helper?.owner ? <a href={`/avatar/${this.helper.owner}`}>{this.helper.ownerName}</a> : <span>None</span>}</dd>
            <dt>Size</dt>
            <dd>
              {space.width}
              &times;
              {space.depth}
              {' metres'}
            </dd>
            <dt>Build Height</dt>
            <dd>{space.height} meters</dd>
            <dt>Elevation</dt>
            <dd>
              {0} to {space.height} meters
            </dd>
          </dl>

          <ParcelAdminPanel parcelOrSpace={space} onSave={this.refreshIframe.bind(this)} />
        </aside>
      </section>
    )
  }
}
