import { Component } from 'preact'
import { Animations } from '../../avatar-animations'
import Connector from '../../connector'
import Persona from '../../persona'
import { EmoteAnimation } from '../../states'
import type UserInterface from '../../user-interface'
import { focusFirst, onListArrowKeys } from '../keynav'

export class DancePane extends Component<any, any> {
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
    focusFirst(this.base as HTMLElement, '[tabindex]')
  }

  componentWillUnmount() {
    this.persona.onAnimationChanged.removeCallback(this.onAnimationChanged)
  }

  onAnimationChanged = () => {
    this.setState({ animation: this.persona.animation })
  }

  playAnimation(animation: Animations) {
    this.setState({ animation })
    // remove last EmoteAnimation
    this.persona.popState(this.connector.controls)
    if (animation) {
      this.persona.setState({ state: new EmoteAnimation(animation) }, this.connector.controls)
    }
    this.ui.refocus()
  }

  get ui(): UserInterface {
    return window.ui!
  }

  render() {
    return (
      <section class="emote" onKeyDown={onListArrowKeys}>
        <h2>Dance</h2>

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
      </section>
    )
  }
}

function animationMatches(a: Animations | null, b: Animations | null) {
  return a === b || (!a && !b)
}
