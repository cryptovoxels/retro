import { Component, JSX } from 'preact'
import { sortBy } from 'lodash'
import WearableIcon from '../wearable-icon'
import { findMostSimilarsInArray } from '../../utils'
import { CollectiblesData } from '../../../../common/helpers/collections-helpers'
import { Spinner } from '../../spinner'

type Props = {
  collectibles: CollectiblesData[] | null
  onSelect: (x: CollectiblesData) => void
}
type State = {
  hovered: boolean
  open: boolean
  searchTerm: string
  status: string | null
}
export default class CollectibleSelector extends Component<Props, State> {
  state = {
    open: false,
    hovered: false,
    searchTerm: '',
    status: null,
  }

  get list(): CollectiblesData[] | null {
    if (!this.props.collectibles) {
      return null
    }
    let list = this.props.collectibles.slice()
    let similarNames: string[]
    if (this.state.searchTerm) {
      similarNames = findMostSimilarsInArray(
        this.state.searchTerm.toLowerCase(),
        list.map((c) => c.name.toLowerCase()),
      )
      list = list.filter((collectible) => similarNames.includes(collectible.name.toLowerCase()))
    }

    return sortBy(list, (collectible) => collectible.name)
  }

  componentDidMount() {
    document.addEventListener('pointerdown', () => {
      if (!this.state.hovered && this.state.open) {
        this.toggle()
      }
    })
  }

  toggle() {
    this.setState({ open: !this.state.open })
  }

  onInput = (e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    this.setState({ searchTerm: e.currentTarget.value })
  }

  onSelectBlur = (e: JSX.TargetedFocusEvent<HTMLInputElement>) => {
    e.currentTarget.value = ''
  }

  captureEnter = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Causes a re-render and a refresh
      this.setState({ searchTerm: this.state.searchTerm })
    }
  }

  render() {
    let collectibles = this.list ? (
      this.list.map((collectible: any) => {
        return (
          <li
            key={collectible.id}
            onClick={() => {
              this.props.onSelect(collectible)
              this.setState({ open: false })
            }}
            title={collectible.description || ''}
          >
            <WearableIcon id={String(collectible.id)} title={collectible.name} />
            {collectible.name}
            <br />
            <small>{collectible.description}</small>
          </li>
        )
      })
    ) : (
      <li title="Loading">
        <div>
          <Spinner size={18} bg="dark" />
        </div>
        <br />
      </li>
    )
    if (Array.isArray(collectibles) && collectibles.length == 0) {
      collectibles = [
        <li title="No Collectible Found">
          No Collectible Found
          <br />
        </li>,
      ]
    }

    return (
      <div className={'CollectibleSelector ' + (this.state.open ? 'open' : 'closed')} onMouseOver={() => this.setState({ hovered: true })} onMouseOut={() => this.setState({ hovered: false })}>
        <ul>
          <li onClick={() => this.toggle()}>
            <input type="text" placeholder="Select a collectible..." id="" onBlur={this.onSelectBlur} onInput={this.onInput} onKeyUp={this.captureEnter} />
          </li>
          {collectibles}
        </ul>
      </div>
    )
  }
}
