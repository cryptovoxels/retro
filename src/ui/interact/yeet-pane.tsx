import { Component } from 'preact'
import { truncate } from 'lodash'
import WearableIcon from '../../../web/src/components/wearable-icon'
import { yeetCollectionId } from '../../store'
import { focusFirst, onGridArrowKeys } from '../../../web/src/helpers/keynav'
import { yeetWearable } from '../../object-vox'
import { effect } from '@preact/signals'

type Collectible = { id: string; name: string; token_id?: string }

type State = {
  name?: string
  collectibles: Collectible[]
  loading?: boolean
  collectionId?: string
}

const DEFAULT_COLLECTION = '1'

export class YeetPane extends Component<{}, State> {
  state: State = { collectibles: [], loading: true }
  private stop: (() => void) | null = null

  componentDidMount() {
    this.stop = effect(() => {
      const id = yeetCollectionId.value || DEFAULT_COLLECTION
      if (id !== this.state.collectionId) this.fetch(id)
    })
  }

  componentWillUnmount() {
    this.stop?.()
  }

  async fetch(id: string) {
    this.setState({ loading: true, collectionId: id })
    try {
      const p = await fetch(`/api/collections/${id}`)
      const { collection } = await p.json()
      const f = await fetch(`/api/collections/${id}/collectibles`)
      const { collectibles } = await f.json()
      this.setState({ name: collection?.name, collectibles: collectibles || [], loading: false }, () => {
        focusFirst(this.base as HTMLElement, '[tabindex]')
      })
    } catch {
      this.setState({ loading: false, collectibles: [] })
    }
  }

  render() {
    if (this.state.loading) {
      return (
        <section class="yeet">
          <h2>Yeet</h2>
          <p>Loading...</p>
        </section>
      )
    }

    return (
      <section class="yeet" onKeyDown={onGridArrowKeys}>
        <h2>{this.state.name || 'Yeet'}</h2>
        <div class="wrap-grid">
          {this.state.collectibles.map((w) => (
            <div
              key={w.id}
              tabIndex={0}
              draggable
              onClick={() => yeetWearable(w.id)}
              onDragStart={(e: DragEvent) => {
                e.dataTransfer?.setData('text/x-yeet', w.id)
                e.dataTransfer?.setData('text/plain', `yeet:${w.id}`)
              }}
            >
              <WearableIcon id={w.id} title={w.name} />
              <p>{truncate(w.name, { length: 40 })}</p>
            </div>
          ))}
        </div>
      </section>
    )
  }
}
