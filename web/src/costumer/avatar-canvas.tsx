import { createEngine } from '../../../common/helpers/utils'
import { Component, createRef } from 'preact'
import { setupScene } from './utils'
import Avatar from './avatar'
import { Wearable } from './wearable'
import { ApiAvatar } from '../../../common/messages/api-avatars'
import { CostumeAttachment } from '../../../common/messages/costumes'

const fetchParams = {
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  credentials: 'include',
} as const

export interface Props {
  wallet: string
  avatar?: ApiAvatar
  dance?: string
  costume?: any
}

export interface State {
  wallet: string
  avatar?: ApiAvatar
  renderReady: boolean
  dance: string
}

const animationsList = ['Idle', 'Walk', 'Dance', 'Run', 'Floating', 'Sitting', 'Spin', 'Savage', 'Uprock', 'Floss', 'Backflip', 'Celebration', 'Orange', 'Hype', 'Shocked', 'Wipe', 'Applause', 'Jump', 'Flyingkick']

export default class AvatarCanvas extends Component<Props, State> {
  private engine: BABYLON.Engine | null = null
  private scene: BABYLON.Scene | null = null
  private canvas = createRef()

  constructor(props: Props) {
    super(props)
    this.state = { wallet: props.wallet ? props.wallet : '', avatar: props.avatar, renderReady: false, dance: props.dance || 'Idle' }
  }

  private get costume() {
    return this.props.costume || this.props.avatar?.costume || this.state.avatar?.costume
  }

  componentDidMount() {
    this.engine = createEngine(this.canvas.current, true, { preserveDrawingBuffer: true, stencil: true })
    this.scene = setupScene(this.canvas.current, this.engine, () => {
      /* do nothing onClick */
    })

    window.addEventListener(
      'resize',
      () => {
        this.engine?.resize()
      },
      { passive: true },
    )

    this.engine.runRenderLoop(() => {
      this.scene?.render()
    })

    this.fetch()
      .then(() => this.setState({ renderReady: true }))
      .catch(console.error)
  }

  async fetch() {
    // no fetch needed, parent provided the avatar via props
    if (this.props.avatar) return
    if (!this.props.wallet) return

    let r = await fetch(`/api/avatars/${this.props.wallet}.json`, fetchParams)
    let { avatar } = await r.json()
    this.setState({ avatar })
  }

  render() {
    let wearables = []

    if (this.scene && this.costume?.attachments) {
      wearables = this.costume.attachments.map((attachment: CostumeAttachment) => {
        return <Wearable key={`${this.costume.id}-${attachment.wid}-${this.state.dance}`} scene={this.scene} attachment={attachment} selected={false} />
      })
    }

    const avatar = this.scene && (
      <Avatar key={`${this.costume?.id}-${this.state.dance}`} scene={this.scene} costume={this.costume} dance={this.state.dance}>
        {wearables}
      </Avatar>
    )

    return (
      <div>
        <canvas ref={this.canvas} onWheel={(ev: WheelEvent) => ev.preventDefault()} class="avatar-canvas costumer" />

        {avatar}

        <div class="f f-dance">
          <label>Dance:&nbsp;</label>
          <select onChange={(e) => this.setState({ dance: String(e.currentTarget?.value) })}>
            {animationsList.map((name) => {
              return (
                <option key={name} value={name} selected={name === this.state.dance}>
                  {name}
                </option>
              )
            })}
          </select>
        </div>
      </div>
    )
  }
}
