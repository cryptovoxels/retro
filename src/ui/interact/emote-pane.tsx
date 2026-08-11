import { Component } from 'preact'
import { Emotes } from '../../../common/messages/constant'
import Connector from '../../connector'
import type UserInterface from '../../user-interface'
import { focusFirst, onListArrowKeys } from '../keynav'

export class EmotePane extends Component {
  get connector(): Connector {
    return window.connector
  }

  get emojis() {
    // Emotes are from the @cryptovoxels/messages; see https://github.com/cryptovoxels/messages/pull/7
    return Emotes
  }

  componentDidMount() {
    focusFirst(this.base as HTMLElement, '[tabindex]')
  }

  emote(emoji: string) {
    this.connector.emote(emoji)
    this.ui.refocus()
  }

  get ui(): UserInterface {
    return window.ui!
  }

  render() {
    return (
      <section class="emote" onKeyDown={onListArrowKeys}>
        <h2>Emote</h2>

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
