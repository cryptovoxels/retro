import { Component } from 'preact'
import { SimpleSpaceRecord } from '../../common/messages/space'
import { loadingBox } from '../src/components/loading-icon'
import { SpacePropertyItem } from '../src/components/property-item'
import cachedFetch from '../src/helpers/cached-fetch'
import SpaceHelper from '../src/space-helper'
import { app } from '../src/state'
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
  creating: boolean
  showAll: boolean
}

export class Spaces extends Component<Props, State> {
  state: State = { spaces: [], loading: false, showAll: false, creating: false }

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
    cacheBust && app.showSnackbar('Refreshing, this can take a few seconds...')
    cachedFetch(`${process.env.API}/wallet/${this.props.wallet}/spaces.json` + (cacheBust ? `?cb=${Date.now()}` : ''), fetchOptions(), TTL)
      .then((r) => r.json())
      .then((r: { spaces?: SimpleSpaceRecord[] }) => {
        let spaces = (r.spaces || []).sort((a, b) => (a.name > b.name ? 1 : -1))
        // don't show other users unlisted spaces
        if (!this.props.isOwner) {
          spaces = spaces.filter((s) => s.unlisted !== true)
        }

        this.setState({ spaces, loading: false })
      })
  }

  toggle() {
    this.setState({ creating: !this.state.creating })
  }

  render() {
    if (this.state.loading) {
      return loadingBox()
    }

    const showTheseMany = 16
    const spaces = this.state.spaces.slice(0, this.state.showAll ? this.state.spaces.length : showTheseMany).map((s) => <SpacePropertyItem spaceHelper={new SpaceHelper(s)} record={s} onRemove={() => this.fetch(true)} />)

    if (spaces.length === 0) return null

    return (
      <div>
        <h2>Spaces</h2>
        <table class="spaces">
          <tbody>{spaces}</tbody>
        </table>
        {!!this.props.isOwner && (
          <p>
            <a href="/spaces/new">Create a space</a>
          </p>
        )}
      </div>
    )
  }
}
