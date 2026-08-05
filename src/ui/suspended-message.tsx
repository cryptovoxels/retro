import { render } from 'preact'
import { format } from 'timeago.js'
import { SuspendedMessage } from '../../common/messages/grid'
import { openDialog } from '../../common/helpers/ui-helpers'

export function displaySuspendedMessage(bannedMessage: SuspendedMessage) {
  const { el, close } = openDialog('suspended-window pointer-lock-close overlay')

  render(
    <div>
      <button className="close" onClick={close}>
        &times;
      </button>
      <h3>Your account has been temporarily suspended</h3>
      <p>You won’t be able to build or chat with other users. Your wearables won’t be displayed in world and your avatar will appear anonymous.</p>
      <p>
        <strong>The reason for this suspension:</strong>
        <br />
        {bannedMessage.reason}
      </p>
      <p style="color: yellow;">Your account will be reactivated {format(bannedMessage.expiresAt)}</p>
      <p>
        <button onClick={close}>Oh, okay then</button>
      </p>
    </div>,
    el,
  )
}
