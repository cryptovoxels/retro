import { Component } from 'preact'
import { Emotes } from '../../../common/messages/constant'
import { Animations } from '../../avatar-animations'
import Connector from '../../connector'
import Persona from '../../persona'
import { EmoteAnimation } from '../../states'
import type UserInterface from '../../user-interface'

interface Props {
  onClose?: () => void
}

export class EmoteOverlay extends Component<Props, any> {
  constructor() {
    super()

    this.state = {
      animation: this.persona.animation,
    }
  }

  get connector(): Connector {
    return window.connector
  }

  get persona(): Persona {
    return this.connector.persona
  }

  get emojis() {
    // Emotes are from the @cryptovoxels/messages; see https://github.com/cryptovoxels/messages/pull/7
    return Emotes
  }

  get animations() {
    return [
      { name: 'Idle', animation: null },
      { name: 'Wave', animation: Animations.Wave },
      { name: 'Dance', animation: Animations.Dance },
      { name: 'Sitting', animation: Animations.Sitting },
      { name: 'Spin', animation: Animations.Spin },
      { name: 'Savage', animation: Animations.Savage },
      { name: 'Uprock', animation: Animations.Uprock },
      { name: 'Floss', animation: Animations.Floss },
      { name: 'Backflip', animation: Animations.Backflip },
      { name: 'Celebrate', animation: Animations.Celebration },
      { name: 'Orange', animation: Animations.Orange },
      { name: 'Hype', animation: Animations.Hype },
      { name: 'Shocked', animation: Animations.Shocked },
      { name: 'Wipe', animation: Animations.Wipe },
      { name: 'Applause', animation: Animations.Applause },
    ]
  }

  componentDidMount() {
    this.persona.onAnimationChanged.add(this.onAnimationChanged)
  }

  componentWillUnmount() {
    this.persona.onAnimationChanged.removeCallback(this.onAnimationChanged)
  }

  onAnimationChanged = () => {
    this.setState({ animation: this.persona.animation })
  }

  emote(emoji: string) {
    this.connector.emote(emoji)
    this.refocus()
  }

  playAnimation(animation: Animations) {
    this.setState({ animation })
    // remove last EmoteAnimation
    this.persona.popState(this.connector.controls)
    if (animation) {
      this.persona.setState({ state: new EmoteAnimation(animation) }, this.connector.controls)
    }
    this.refocus()
  }

  refocus() {
    this.ui.refocus()
  }

  get ui(): UserInterface {
    return window.ui!
  }

  render() {
    return (
      <section class="emote">
        <header>
          <h2>Dance</h2>
        </header>

        <div class="AnimateList">
          <ul>
            {this.animations.map((a) => (
              <li key={a.name} class={animationMatches(this.state.animation, a.animation) ? '-active' : ''} tabIndex={0} onClick={() => this.playAnimation(a!.animation!)}>
                {animationMatches(this.state.animation, a.animation) && '⭐️'}
                {a.name}
              </li>
            ))}
          </ul>
        </div>

        <div class="EmoteList">
          <ul>
            {this.emojis.slice(0, 40).map((e) => (
              <li key={e} tabIndex={0} onClick={() => this.emote(e)}>
                {e}
              </li>
            ))}
          </ul>
        </div>
      </section>
    )
  }
}

function animationMatches(a: Animations | null, b: Animations | null) {
  return a === b || (!a && !b)
}
