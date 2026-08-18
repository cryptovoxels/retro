import { Component } from 'preact'
import { Animations } from '../../avatar-animations'
import Connector from '../../connector'
import Persona from '../../persona'
import { focusFirst, onListArrowKeys } from '../keynav'
import { dances } from './dances'

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

  playAnimation(animation: Animations | null) {
    if (animation != null && animation === this.persona.emote) this.persona.playEmote(null)
    else this.persona.playEmote(animation)
  }

  render() {
    return (
      <section class="emote" onKeyDown={onListArrowKeys}>
        <h2>Dance</h2>

        <div class="AnimateList">
          <ul>
            {dances.map((a) => (
              <li key={a.name} class={animationMatches(this.state.animation, a.animation) ? '-active' : ''} tabIndex={0} onClick={() => this.playAnimation(a.animation)}>
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
