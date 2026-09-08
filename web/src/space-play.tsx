import { Component } from 'preact'
import { fetchOptions } from './utils'
import { ssrFriendlyDocument } from '../../common/helpers/utils'
import { SpaceRecord } from '../../common/messages/space'
import { avatarName } from '../../common/messages/avatar-ref'
import Head from './components/head'
import cachedFetch from './helpers/cached-fetch'

function ownerHref(owner: SpaceRecord['owner']): string | null {
  if (!owner) return null
  if (typeof owner === 'string') return `/avatar/${owner}`
  if (typeof owner === 'object' && (owner as any).owner) return `/avatar/${(owner as any).owner}`
  return null
}

export interface Props {
  space?: SpaceRecord
  path?: string
  id?: string
}

export interface State {
  space: SpaceRecord | null
  error: string | null
}

export default class SpacePlay extends Component<Props, State> {
  constructor(props: Props) {
    super()
    this.state = { space: props.space ?? null, error: null }
  }

  componentDidMount() {
    this.fetch()
  }

  componentDidUpdate(prev: Props) {
    if (prev.id != this.props.id) this.fetch()
  }

  fetch() {
    if (!this.props.id) return
    cachedFetch(`/api/spaces/${this.props.id}.json`, fetchOptions())
      .then((r) => r.json())
      .then((r) => {
        if (!r?.space) {
          this.setState({ error: 'not found', space: null })
          return
        }
        this.setState({ space: r.space, error: null })
      })
      .catch(() => this.setState({ error: 'failed to load', space: null }))
  }

  downloadJson = () => {
    const space = this.state.space
    if (!space) return
    const blob = new Blob([JSON.stringify({ space }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    const safe = (space.name || space.id || 'space').replace(/[^\w.-]+/g, '_')
    a.href = URL.createObjectURL(blob)
    a.download = `${safe}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  render() {
    const space = this.state.space
    const name = space?.name || space?.id || 'space'
    const owner = space ? avatarName(space.owner) : ''
    const href = space ? ownerHref(space.owner) : null

    return (
      <section style={{ padding: '1rem', maxWidth: '40rem' }}>
        {space && <Head title={name} description={`viewing ${name}`} url={`/spaces/${space.id}/play`} />}

        <h1>{name}</h1>

        {this.state.error && <p>{this.state.error}</p>}

        {space && (
          <>
            <p>
              {space.width}&times;{space.height}&times;{space.depth}
              {' · '}
              owner {href ? <a href={href}>{owner}</a> : owner || 'none'}
            </p>

            {space.description && <p>{space.description}</p>}

            <p>
              <button type="button" class="outline" onClick={this.downloadJson}>
                download space
              </button>{' '}
              <a href={`/spaces/${space.id}`}>archive page</a> <a href={`/api/spaces/${space.id}.json`}>json</a>
            </p>
          </>
        )}

        {!space && !this.state.error && <p>loading…</p>}
      </section>
    )
  }
}
