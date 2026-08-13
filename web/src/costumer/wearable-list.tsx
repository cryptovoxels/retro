import { Component, Fragment } from 'preact'
import WearableIcon from '../components/wearable-icon'
import { app } from '../../src/state'
import { PanelType } from '../../src/components/panel'
import { CollectiblesData, fetchUsersCollectiblesData, fetchFreeWearablesData, mergeOwnedAndFreeWearables } from '../../../common/helpers/collections-helpers'
import { Spinner } from '../../src/spinner'

type WearableListState = {
  wearables: CollectiblesData[]
  loading: boolean
  query: string
}

type Props = {
  onPickWearable?: (wearable: CollectiblesData, bone: string) => void
}

export default class WearableList extends Component<Props, WearableListState> {
  queries = 0
  state: WearableListState = {
    wearables: [],
    loading: true,
    query: '',
  }

  handleSearch = (event: any) => {
    this.setState({ query: event.target.value })
  }

  renderColumn(title: string, items: CollectiblesData[]) {
    if (!items.length) {
      return null
    }
    return (
      <div class="wearable-hand-column">
        <h4>{title}</h4>
        <ul class="wearables-list">{items.map((wearable) => this.renderWearableRow(wearable))}</ul>
      </div>
    )
  }

  renderWearableRow(wearable: CollectiblesData) {
    const onClick = () => {
      if (this.props.onPickWearable) {
        this.props.onPickWearable(wearable, wearable.default_bone || 'lefthand')
      }
    }

    return (
      <li key={wearable.id} onClick={onClick}>
        <WearableIcon id={String(wearable.id)} title={wearable.name} />
        <address>{wearable.name}</address>
        {this.props.onPickWearable ? (
          <div class="wearable-pick-row">
            <button type="button" onClick={(e) => this.pickHand(e, wearable, 'LeftHand')}>
              L
            </button>
            <button type="button" onClick={(e) => this.pickHand(e, wearable, 'RightHand')}>
              R
            </button>
          </div>
        ) : null}
      </li>
    )
  }

  pickHand = (e: MouseEvent, wearable: CollectiblesData, bone: string) => {
    e.preventDefault()
    e.stopPropagation()
    this.props.onPickWearable?.(wearable, bone)
  }

  render() {
    const q = this.state.query.toLowerCase()
    const filteredWearables = this.state.wearables.filter((wearable) => {
      return (wearable.name ?? '').toLowerCase().includes(q)
    })

    const left = filteredWearables.filter((w) => (w.default_bone || '').startsWith('Left'))
    const right = filteredWearables.filter((w) => (w.default_bone || '').startsWith('Right'))
    const other = filteredWearables.filter((w) => {
      const b = w.default_bone || ''
      return !b.startsWith('Left') && !b.startsWith('Right')
    })

    return (
      <Fragment>
        <h3>Wearables {this.state.loading && <Spinner size={16} />}</h3>
        <input type="search" value={this.state.query} placeholder="Search wearables" onChange={this.handleSearch} />
        <div class="column-header"></div>
        <div class="wearable-hand-columns">
          {this.renderColumn('Left hand', left)}
          {this.renderColumn('Right hand', right)}
          {this.renderColumn('Other slots', other)}
        </div>
      </Fragment>
    )
  }

  async fetch() {
    this.setState({ loading: true })
    try {
      const free = await fetchFreeWearablesData()
      const owned = app.state.wallet ? await fetchUsersCollectiblesData(app.state.wallet) : []
      const wearables = mergeOwnedAndFreeWearables(owned, free)
      wearables.sort((w1, w2) => (w1.name || '').localeCompare(w2.name || ''))
      this.setState({ loading: false, wearables })
    } catch (e) {
      console.error(e)
      this.setState({ loading: false, wearables: [] })
    }
  }

  componentDidMount() {
    this.fetch().catch(console.error.bind(console))
  }
}
