import { Component, createRef, JSX } from 'preact'
import { forwardRef } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { isMobile } from '../../../common/helpers/detector'
import { Emojis, replaceEmojiText, replaceEmoticonsAndEmojiText } from '../../../common/helpers/emojis'
import { Emotes } from '../../../common/messages/constant'
import { PanelType } from '../../../web/src/components/panel'
import { app } from '../../../web/src/state'
import Avatar from '../../avatar'
import Connector, { ChatMessageRecord, messageList } from '../../connector'
import GuestBook from '../../features/guest-book'
import Persona from '../../persona'
import type { Scene } from '../../scene'
import { NearByPlayers } from './nearby-players'

interface Props {
  scene: Scene
  focusChatInput?: () => void
}

type TimeStamp = number
type State = {
  nearby: Avatar[]
  lastRead: TimeStamp
  focused: boolean
}

export class ChatOverlay extends Component<Props, State> {
  lastSentTyping: number | null = null
  inputRef: preact.RefObject<HTMLDivElement>
  static instance: ChatOverlay | null = null
  constructor(props: Props) {
    super(props)

    this.state = {
      nearby: [],
      lastRead: Date.now(),
      focused: false,
    }
    this.inputRef = createRef<HTMLDivElement>()
    ChatOverlay.instance = this
  }

  get connector(): Connector {
    return window.connector
  }

  get persona(): Persona {
    return this.connector.persona
  }

  get messagesDiv() {
    // fixme: there MUST be a better way :/
    return document.querySelector('.InteractOverlay .ChatMessages')
  }

  get isDPadVisible() {
    return !!(this.connector.controls as any).dpad
  }

  componentDidMount() {
    this.scrollToBottom()
  }

  typing = () => {
    const now = Date.now()
    if (!this.lastSentTyping || now - this.lastSentTyping > 4e3) {
      this.lastSentTyping = now
      this.connector.typing()
    }
  }

  focusInput() {
    const input = this.inputRef.current?.querySelector('input')
    input?.focus()
  }

  onChatInputFocus = (bool: boolean) => {
    this.setState({ focused: bool })
  }

  scrollToBottom() {
    try {
      if (this.messagesDiv) {
        this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight
      }
    } catch (e) {}
  }

  componentDidUpdate() {
    this.scrollToBottom()
  }

  render() {
    const name = (m: ChatMessageRecord) => {
      const avatar = m.avatar ? window.connector.findAvatar(m.avatar) : null
      return avatar?.description?.name || avatar?.description?.wallet?.substring(0, 10) || m.name || 'anon'
    }

    return (
      <main class="chat">
        <div class={'chat-messages'}>
          {messageList.value.map((m) => (
            <p>
              <span>{`${name(m)}: ${m.text}`}</span>
            </p>
          ))}
        </div>

        <ChatInput />
      </main>
    )
  }
}

const ChatInput = () => {
  const [currentMessage, setMessage] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  const say = (e: Event) => {
    setMessage('')

    if (currentMessage) {
      window.connector.sendMessage(currentMessage)
    } else {
      blur()
    }

    e.preventDefault()
  }

  const blur = () => {
    inputRef.current?.blur()
  }

  const onChatKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      say(e)

      if (!e.shiftKey) {
        blur()
      }
    } else if (e.key === 'Escape') {
      setMessage('')
      blur()
    } else {
      // typing()
    }
  }

  const followTarget = window.connector?.controls?.followTarget

  return (
    <div>
      {followTarget && (
        <div style="padding: 4px 8px; color: #a5d6a7; font-size: 12px;">
          Following {followTarget.name} -- press any key to stop
        </div>
      )}
      <form onSubmit={say}>
        <input type="text" onKeyDown={onChatKeydown} value={currentMessage} onChange={(e: any) => setMessage(e.target.value)} ref={inputRef} />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}
