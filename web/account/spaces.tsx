import { Component } from 'preact'
import { SimpleSpaceRecord } from '../../common/messages/space'
import { avatarName } from '../../common/messages/avatar-ref'
import cachedFetch from '../src/helpers/cached-fetch'
import { fetchOptions } from '../src/utils'

const TTL = 60

export interface Props {
  cacheBust?: boolean
  wallet?: string
  isOwner?: boolean
}

export interface State {
  spaces: SimpleSpaceRecord[]
  loading: boolean
  showAll: boolean
}

export class Spaces extends Component<Props, State> {
  state: State = { spaces: [], loading: false, showAll: false }

  toggleShowAll() {
    this.setState({ showAll: !this.state.showAll })
  }

  componentDidMount() {
    this.fetch()
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (prevState == this.state && this.props.cacheBust) {
      this.fetch(true)
    }
  }

  fetch(cacheBust = false) {
    this.setState({ loading: true })
    cachedFetch(`${process.env.API}/wallet/${this.props.wallet}/spaces.json` + (cacheBust ? `?cb=${Date.now()}` : ''), fetchOptions(), TTL)
      .then((r) => r.json())
      .then((r: { spaces?: SimpleSpaceRecord[] }) => {
        let spaces = (r.spaces || []).sort((a, b) => (a.name > b.name ? 1 : -1))
        if (!this.props.isOwner) {
          spaces = spaces.filter((s) => s.unlisted !== true)
        }
        this.setState({ spaces, loading: false })
      })
  }

  render() {
    if (this.state.loading) {
      return null
    }

    const showTheseMany = 16
    const total = this.state.spaces.length
    const spaces = this.state.spaces.slice(0, this.state.showAll ? total : showTheseMany)

    if (spaces.length === 0) return null

    return (
      <div>
        <h2>Spaces</h2>
        <p>spaces are deprecated — download the json archive.</p>
        <ul>
          {spaces.map((s) => (
            <li>
              <a href={`/spaces/${s.id}`}>{s.name || s.id}</a>
              {s.owner && <span> — {avatarName(s.owner as any)}</span>}
            </li>
          ))}
        </ul>
        {total > showTheseMany && (
          <p>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                this.toggleShowAll()
              }}
            >
              {this.state.showAll ? 'show less' : `see all ${total}`}
            </a>
          </p>
        )}
      </div>
    )
  }
}
