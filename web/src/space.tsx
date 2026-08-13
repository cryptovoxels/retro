import { Component } from 'preact'
import EditableName from './components/Editable/editable-name'
import { fetchOptions } from './utils'
import { app } from './state'
import { AssetType } from './components/Editable/editable'
import SpaceHelper from './space-helper'
import EditableDescription from './components/Editable/editable-description'
import { copyTextToClipboard, ssrFriendlyDocument } from '../../common/helpers/utils'
import WompsList from './womps-list'
import { SpaceRecord } from '../../common/messages/space'
import Head from './components/head'
import JsonData from './components/json-data'
import { WorldAside } from './world-aside'

function spaceFastboot(space: any) {
  const desc = { ...space, voxels: space.voxels || space.content?.voxels || '' }
  let el = document.querySelector('script#space') as HTMLScriptElement | null
  if (!el) {
    el = document.createElement('script')
    el.id = 'space'
    el.type = 'text/json'
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(desc)
  window.grid?.applySpaceFastboot(desc)
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
    return app.isOwner(this.state.space?.owner)
  }

  get name() {
    return this.state.space?.name || this.state.space?.id || ''
  }

  get hasSlug() {
    return !!this.state.space && this.state.slug !== this.state.space.id
  }

  componentDidMount() {
    // the engine boots once per page load with the world baked in - if a different
    // world is already running (soft nav from home/parcel), reload so this space boots
    if (window.config && window.config.spaceId !== String(this.props.id)) {
      location.reload()
      return
    }
    this.syncVisitUrl()
    if (this.state.space) spaceFastboot(this.state.space)
    this.fetch()
  }

  // the header Play button enters this space
  syncVisitUrl() {
    if (this.helper) app.visitUrl.value = this.helper.visitUrl
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
        const space = Object.assign({}, this.props.space, r.space, { spaceId: r.space.id })
        this.setState({ space, slug: r.space.slug || r.space.id })
        spaceFastboot(space)
      })
  }

  componentDidUpdate(props: any) {
    this.syncVisitUrl()
    if (props.id != this.props.id) {
      this.fetch()
    }
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

    // same template as the parcel page: the world fills the grid cell,
    // details live in the one WorldSidebar aside. Render the slot even
    // while fetching so the client docks instead of falling to the mini view.
    return (
      <section class="columns space-page">
        <article>
          {space && (
            <Head title={this.name} description={space.description ?? `Visit this space`} url={`/spaces/${space.id}`}>
              <JsonData id="space" data={{ ...space, voxels: space.voxels || space.content?.voxels || '' }} dataId={space.id} />
            </Head>
          )}
          <div class="client-slot" />
        </article>
        {space && (
          <WorldAside>
            <header>
              <EditableName value={space.name} path={this.props.path} isowner={this.isOwner} type={AssetType.Space} data={this.state.space} title="Name of this space" />
            </header>

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

            {(this.isOwner && (
              <div>
                <EditableDescription value={space.description} isowner={this.isOwner} type={AssetType.Space} data={this.state.space} title="Description of this space" />
              </div>
            )) ||
              space.description}

            {this.isOwner && <a href={`/spaces/${space.id}/edit`}>Edit</a>}

            <h3>Womps</h3>
            <WompsList fetch={`/womps/at/space/${space.spaceId}.json`} />
          </WorldAside>
        )}
      </section>
    )
  }
}
