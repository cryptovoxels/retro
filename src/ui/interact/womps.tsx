import { Component } from 'preact'
import { decodeCoords } from '../../../common/helpers/utils'
import { Womp, WompCard } from '../../../web/src/components/womp-card'
import cachedFetch from '../../../web/src/helpers/cached-fetch'
import Connector from '../../connector'
import { MinimapSettings } from '../../minimap'
import Persona from '../../persona'
import type { Scene } from '../../scene'
import TakeWomp from '../take-womp'

interface Props {
  onClose?: () => void
  scene: Scene
  minimapSettings: MinimapSettings
}

interface State {
  womps: Array<Womp>
  loaded: boolean
}

export class WompOverlay extends Component<Props, State> {
  constructor(props: Props) {
    super(props)

    this.state = {
      womps: [],
      loaded: false,
    }
  }

  static close() {
    const overlay = document.querySelector('.InteractOverlay')
    if (overlay) {
      overlay.remove()
    }
  }

  get isLoggedInOnMultiplayerServer() {
    console.log('connector', this.connector)
    return !!this.connector?.persona.description?.wallet
  }

  private get connector(): Connector {
    return window.connector
  }

  private get persona(): Persona {
    return window.persona
  }

  close() {
    this.props.onClose?.()
  }

  takeWomp() {
    const engine = this.props.scene.getEngine()
    TakeWomp.Capture(engine, this.props.scene, this.props.minimapSettings)
  }

  onClick = (womp: Womp) => {
    if (this.props.scene.config.isSpace) {
      //IF we're currently in a space and we click a broadcast womp, take us in-world
      window.ui?.openLink(`/play?coords=${womp.coords}`)
      return
    }
    this.teleportTo(womp.coords)
    return false
  }

  componentDidMount() {
    this.fetch()
  }

  async fetch() {
    let f = await cachedFetch('/api/womps.json')
    let { womps } = await f.json()

    this.setState({ womps })
  }

  teleportTo(coords: string) {
    this.persona.teleport(decodeCoords(coords))
  }

  render() {
    return (
      <section class="le-wompies">
        <header>
          <h2>Womps</h2>
        </header>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, marginBottom: '10px' }}>
          <span style={{ flex: 1, fontSize: 'smaller' }}>Explore womps captured by other users, click to teleport!</span>
          {this.isLoggedInOnMultiplayerServer && (
            <button title="Take in world screenshot and share with others" onClick={() => this.takeWomp()} class="TakeWompButton">
              Capture {'[P]'}
            </button>
          )}
        </div>
        <div class="grid">
          {this.state.womps.map((womp) => (
            <div class="womp" key={womp.id}>
              <WompCard womp={womp} hoverText={`Click to teleport to ${womp.coords}`} className="-compact" onClick={this.onClick.bind(this)} />
            </div>
          ))}
        </div>
      </section>
    )
  }
}
