import { Component, render } from 'preact'
import { app } from '../../state'
import Panel from '../panel'
import WearableHelper from '../../helpers/collectible'
import { AssetType } from '../Editable/editable'
import EditableDescription from '../Editable/editable-description'
import EditableName from '../Editable/editable-name'
import { CollectibleRecord } from '../../../../common/messages/collectibles'

export interface Props {
  onClose?: () => void
  refresh?: (cacheBust?: boolean) => void
  wallet?: string
  collectible: CollectibleRecord
}

export interface State {
  error: string
  collectible: CollectibleRecord
  name: string
  description: string
}

export class EditCollectibleWindow extends Component<Props, State> {
  static currentElement: Element

  constructor(props: Props) {
    super()

    this.state = {
      error: null!,
      collectible: props.collectible || null!,
      name: props.collectible.name || '',
      description: props.collectible.description || '',
    }
  }

  get collectible(): WearableHelper {
    return new WearableHelper(this.props.collectible)
  }

  componentDidMount() {}

  onSave = () => {
    this.props.refresh && this.props.refresh(true)
  }

  render() {
    return (
      <div>
        <header>
          <h3>Edit Collectible</h3>
          <button onClick={this.props.onClose}>&times;</button>
        </header>
        <section>
          <p>
            Edit the collectible {this.collectible.name}, token id: {this.collectible.token_id}
          </p>
          {this.state.error && <Panel type="danger">{this.state.error}</Panel>}
          <form>
            <div>
              <div>
                <label>Name:</label>
              </div>
              <div>
                <EditableName onSave={this.onSave} value={this.collectible.name || null} isowner={this.collectible.isAuthor(app.state.wallet)} type={AssetType.Collectible} data={this.collectible} title="Name of this collectible" />
              </div>
            </div>
            <div>
              <div>
                <label>Description:</label>
              </div>
              <div>
                <EditableDescription
                  onSave={this.onSave}
                  value={this.collectible.description || null}
                  isowner={this.collectible.isAuthor(app.state.wallet)}
                  type={AssetType.Collectible}
                  data={this.collectible}
                  title="Description of this collectible"
                />
              </div>
            </div>
          </form>
        </section>
      </div>
    )
  }
}

export function toggleEditCollectibleWindow(collectible: CollectibleRecord, onClose?: (cacheBust?: boolean) => void) {
  if (EditCollectibleWindow.currentElement?.parentElement) {
    render(null, EditCollectibleWindow.currentElement)
    EditCollectibleWindow.currentElement = null!
  } else {
    const div = document.createElement('div')
    document.body.appendChild(div)
    EditCollectibleWindow.currentElement = div

    render(
      <EditCollectibleWindow
        collectible={collectible}
        refresh={onClose}
        onClose={() => {
          !!EditCollectibleWindow.currentElement && render(null, EditCollectibleWindow.currentElement)
          EditCollectibleWindow.currentElement = null!
          div?.remove()
        }}
      />,
      div,
    )
  }
}
