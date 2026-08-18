import { Component } from 'preact'
import { truncate } from 'lodash'
import WearableIcon from '../../../web/src/components/wearable-icon'
import { yeetCollectionId } from '../../store'
import { focusFirst, onListArrowKeys } from '../keynav'
import { yeetWearable } from '../../object-vox'
import { effect } from '@preact/signals'

type Collectible = { id: string; name: string; token_id?: string }

type State = {
  name?: string
  collectibles: Collectible[]
  selected?: string
  loading?: boolean
  collectionId?: string
}

export class YeetPane extends Component<{}, State> {
  state: State = { collectibles: [], loading: true }
  private stop: (() => void) | null = null

  componentDidMount() {
    this.stop = effect(() => {
      const id = yeetCollectionId.value
      if (id !== this.state.collectionId) this.fetch(id)
    })
    focusFirst(this.base as HTMLElement, '[tabindex]')
  }

  componentWillUnmount() {
    this.stop?.()
  }

  async fetch(id?: string) {
    if (!id) {
      this.setState({ loading: false, collectibles: [], name: undefined, collectionId: undefined })
      return
    }
    this.setState({ loading: true, collectionId: id })
    try {
      const p = await fetch(`/api/collections/${id}`)
      const { collection } = await p.json()
      const f = await fetch(`/api/collections/${id}/collectibles`)
      const { collectibles } = await f.json()
      this.setState({ name: collection?.name, collectibles: collectibles || [], loading: false })
    } catch {
      this.setState({ loading: false, collectibles: [] })
    }
  }

  select(id: string) {
    this.setState({ selected: id })
  }

  yeet = () => {
    const wid = this.state.selected
    if (!wid) return
    yeetWearable(wid)
  }

  render() {
    if (!this.state.collectionId) {
      return (
        <section class="yeet">
          <h2>Yeet</h2>
          <p>open a collection first</p>
        </section>
      )
    }

    if (this.state.loading) {
      return (
        <section class="yeet">
          <h2>Yeet</h2>
          <p>Loading...</p>
        </section>
      )
    }

    return (
      <section class="yeet" onKeyDown={onListArrowKeys}>
        <h2>{this.state.name || 'Yeet'}</h2>
        <div class="wrap-grid">
          {this.state.collectibles.map((w) => (
            <div
              key={w.id}
              class={this.state.selected === w.id ? '-active' : undefined}
              tabIndex={0}
              onClick={() => this.select(w.id)}
              onKeyDown={(e: any) => {
                if (e.key === 'Enter') this.select(w.id)
              }}
            >
              <WearableIcon id={w.id} title={w.name} />
              <p>{truncate(w.name, { length: 40 })}</p>
            </div>
          ))}
        </div>
        <button type="button" onClick={this.yeet} disabled={!this.state.selected}>
          yeet
        </button>
      </section>
    )
  }
}
