import { Component, createRef, Fragment, JSX } from 'preact'
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

  get isDPadVisible() {
    return !!(this.connector.controls as any).dpad
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

  render() {
    const name = (m: ChatMessageRecord) => {
      const avatar = m.avatar ? window.connector.findAvatar(m.avatar) : null
      return avatar?.description?.name || avatar?.description?.wallet?.substring(0, 10) || m.name || 'anon'
    }

    return (
      <main class="chat">
        <div class={'chat-messages' + (messageList.value.length >= 10 ? ' at-cap' : '')}>
          {messageList.value.slice(-10).map((m) => (
            <p>
              <span>
                {name(m)}: <ChatText text={m.text} />
              </span>
            </p>
          ))}
        </div>

        <ChatInput />
      </main>
    )
  }
}

const CONGA_CMD_PATTERN = /\/conga\b/
const CONGA_INVITE_PATTERN = /\[\[conga:([0-9a-f-]{36})\]\]/gi

function decodeChatHtmlEntities(encoded: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = encoded
  return el.value
}

/** Linkify /conga only (no [[conga:uuid]] tokens in this slice). */
function SlashCongaLinks({ text }: { text: string }) {
  const match = text.match(CONGA_CMD_PATTERN)
  if (!match) return <>{text}</>

  const before = text.slice(0, match.index)
  const after = text.slice((match.index || 0) + match[0].length)

  const onClick = (e: Event) => {
    e.preventDefault()
    window.connector.sendMessage('/conga')
  }

  return (
    <>
      {before}
      <a href="#" onClick={onClick} style="color: white; text-decoration: underline; cursor: pointer;">
        /conga
      </a>
      {after}
    </>
  )
}

const ChatText = ({ text }: { text: string }) => {
  const decoded = decodeChatHtmlEntities(text)
  if (CONGA_INVITE_PATTERN.test(decoded)) {
    CONGA_INVITE_PATTERN.lastIndex = 0
    const parts: JSX.Element[] = []
    let last = 0
    let k = 0
    let m: RegExpExecArray | null
    while ((m = CONGA_INVITE_PATTERN.exec(decoded)) !== null) {
      if (m.index > last) {
        parts.push(
          <Fragment key={k++}>
            <SlashCongaLinks text={decoded.slice(last, m.index)} />
          </Fragment>,
        )
      }
      const uuid = m[1]
      const onJoin = (e: Event) => {
        e.preventDefault()
        window.connector.joinCongaFromInvitation(uuid)
      }
      parts.push(
        <a key={k++} href="#" onClick={onJoin} style="text-decoration: underline; cursor: pointer;">
          Join
        </a>,
      )
      last = m.index + m[0].length
    }
    if (last < decoded.length) {
      parts.push(
        <Fragment key={k++}>
          <SlashCongaLinks text={decoded.slice(last)} />
        </Fragment>,
      )
    }
    return <>{parts}</>
  }

  return <SlashCongaLinks text={decoded} />
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

  return (
    <div>
      <form onSubmit={say}>
        <input type="text" onKeyDown={onChatKeydown} value={currentMessage} onChange={(e: any) => setMessage(e.target.value)} ref={inputRef} />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}
