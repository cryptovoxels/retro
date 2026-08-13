import { effect } from '@preact/signals'
import { Component, createRef, Fragment, JSX } from 'preact'
import { forwardRef } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'

import { isMobile } from '../../../common/helpers/detector'
import { resetMobileViewportLayout } from '../../controls/mobile/controls'
import { Emojis, replaceEmojiText, replaceEmoticonsAndEmojiText } from '../../../common/helpers/emojis'
import { Emotes } from '../../../common/messages/constant'
import { avatarName } from '../../../common/messages/avatar-ref'
import { PanelType } from '../../../web/src/components/panel'
import { sendChat } from '../../../web/src/shard-chat'
import { app } from '../../../web/src/state'
import Avatar from '../../avatar'
import Connector, { ChatMessageRecord, messageList } from '../../connector'
import GuestBook from '../../features/guest-book'
import Persona from '../../persona'
import { isHate } from '../../hate'
import { matcher } from '../../obscenity'
import { NearByPlayers } from './nearby-players'
import { createEvent, TypedEventTarget } from '../../utils/EventEmitter'

interface Props {
  scene: BABYLON.Scene
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
  chatDispose?: () => void
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

  componentDidMount() {
    this.chatDispose = effect(() => {
      messageList.value
      this.forceUpdate()
    })
  }

  componentWillUnmount() {
    this.chatDispose?.()
    if (ChatOverlay.instance === this) {
      ChatOverlay.instance = null
    }
  }

  render() {
    const isGuest = !!app.state.wallet?.startsWith('guest:')
    const chatCap = isGuest ? 25 : 10
    return <ChatPanel cap={chatCap} variant="overlay" style={isGuest ? 'font-size: 14px' : undefined} />
  }
}

function chatName(m: ChatMessageRecord) {
  if (m.avatarRef) return avatarName(m.avatarRef)
  const avatar = m.avatar ? window.connector?.findAvatar(m.avatar) : null
  return avatar?.name || 'anon'
}

// game-HUD chat: messages show briefly then fade so the world stays visible.
// Focusing the input recalls the full recent history while you type.
const CHAT_FADE_MS = 15000
const CHAT_GONE_MS = 18000

export function ChatPanel({ cap, variant = 'page', class: className, style }: { cap: number; variant?: 'overlay' | 'page'; class?: string; style?: string }) {
  const [, bump] = useState(0)
  const [focused, setFocusedRaw] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // leaving the input restarts the age-out clock so the recalled history
  // fades out instead of vanishing the moment you hit Enter
  const blurAt = useRef(0)
  const setFocused = (f: boolean) => {
    if (!f) blurAt.current = Date.now()
    setFocusedRaw(f)
  }

  useEffect(() => {
    return effect(() => {
      messageList.value
      bump((n) => n + 1)
    })
  }, [])

  // ticker so messages age out without new ones arriving
  useEffect(() => {
    if (variant !== 'overlay') return
    const t = setInterval(() => bump((n) => n + 1), 3000)
    return () => clearInterval(t)
  }, [variant])

  useEffect(() => {
    if (variant !== 'page') return
    const el = box.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  })

  const msgs = messageList.value.slice(-cap)
  const atCap = messageList.value.length >= cap

  if (variant === 'overlay') {
    const now = Date.now()
    const age = (m: ChatMessageRecord) => now - Math.max(m.timestamp, blurAt.current)
    let shown = focused ? msgs : msgs.filter((m) => age(m) < CHAT_GONE_MS)
    // small screens: last 4 lines is plenty, focused or not - the keyboard
    // leaves no room for the full backlog
    if (isMobile()) shown = shown.slice(-4)
    return (
      <div class={'chat' + (className ? ' ' + className : '')} style={style}>
        <div class={'chat-messages' + (atCap ? ' at-cap' : '')}>
          {shown.map((m) => (
            <p key={m.timestamp} class={!focused && age(m) > CHAT_FADE_MS ? 'faded' : undefined}>
              <span class="chat-who">{chatName(m)}</span>
              {': '}
              <ChatText text={m.text} />
            </p>
          ))}
        </div>
        <ChatInput
          onFocusChange={(f) => {
            setFocused(f)
            // safari scrolls the page to keep the input above the keyboard and
            // leaves it there - snap back to the world when done typing
            if (!f && isMobile()) window.scrollTo(0, 0)
          }}
        />
      </div>
    )
  }

  return (
    <div class={'chat-panel' + (className ? ' ' + className : '')} style={style}>
      <div ref={box} class={'chat-messages' + (atCap ? ' at-cap' : '')}>
        {msgs.map((m, i) => (
          <div class="chat-line" key={i}>
            <span class="chat-who">{chatName(m)}</span>
            <span class="chat-text">
              <ChatText text={m.text} />
            </span>
          </div>
        ))}
      </div>
      <ChatInput keepFocus />
    </div>
  )
}

const CONGA_CMD_PATTERN = /\/conga\b/
const CHAT_INVITE_PATTERN = /\[\[(conga|show):([^\]]+)\]\]/gi

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
  if (isHate(decoded)) {
    return <s class="profanity">{decoded}</s>
  }
  const matches = matcher.getAllMatches(decoded, true)
  const parts: JSX.Element[] = []
  let last = 0
  let k = 0

  for (const match of matches) {
    const [start, end] = [match.startIndex, match.endIndex + 1]
    if (start < last) continue
    if (start > last)
      parts.push(
        <Fragment key={k++}>
          <CongaText text={decoded.slice(last, start)} />
        </Fragment>,
      )
    const word = decoded.slice(start, end)
    parts.push(
      <s key={k++} class="profanity">
        {word}
      </s>,
    )
    last = end
  }
  if (last < decoded.length)
    parts.push(
      <Fragment key={k++}>
        <CongaText text={decoded.slice(last)} />
      </Fragment>,
    )

  return <>{parts}</>
}

const CongaText = ({ text }: { text: string }) => {
  if (CHAT_INVITE_PATTERN.test(text)) {
    CHAT_INVITE_PATTERN.lastIndex = 0
    const parts: JSX.Element[] = []
    let last = 0
    let k = 0
    let m: RegExpExecArray | null
    while ((m = CHAT_INVITE_PATTERN.exec(text)) !== null) {
      if (m.index > last)
        parts.push(
          <Fragment key={k++}>
            <SlashCongaLinks text={text.slice(last, m.index)} />
          </Fragment>,
        )
      const kind = m[1]
      const payload = m[2] as string
      const onClick = (e: Event) => {
        e.preventDefault()
        if (kind === 'conga') window.connector.joinCongaFromInvitation(payload)
        else window.connector.joinShowFromInvitation(payload)
      }
      parts.push(
        <a key={k++} href="#" onClick={onClick} style="text-decoration: underline; cursor: pointer;">
          {kind === 'conga' ? 'Join' : 'Watch'}
        </a>,
      )
      last = m.index + m[0].length
    }
    if (last < text.length)
      parts.push(
        <Fragment key={k++}>
          <SlashCongaLinks text={text.slice(last)} />
        </Fragment>,
      )
    return <>{parts}</>
  }
  return <SlashCongaLinks text={text} />
}

const ChatInput = ({ keepFocus, onFocusChange }: { keepFocus?: boolean; onFocusChange?: (focused: boolean) => void }) => {
  const [currentMessage, setMessage] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!keepFocus) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [keepFocus])

  // Mobile guests chat from the broadcast dock when live (panel covers this UI). Desktop guests use normal chat here.
  if (app.state.wallet?.startsWith('guest:') && isMobile()) {
    return <small style="padding: 0 0.5rem; color: #888">chat in the broadcast panel</small>
  }

  const say = (e: Event) => {
    e.preventDefault()
    const msg = currentMessage
    if (!msg?.trim()) return

    if (window.connector) {
      setMessage('')
      window.connector.sendMessage(msg)
    } else if (sendChat(msg)) {
      setMessage('')
    }

    if (keepFocus) {
      inputRef.current?.focus()
    } else {
      blur()
    }
  }

  const blur = () => {
    inputRef.current?.blur()
    if (isMobile()) resetMobileViewportLayout()
  }

  const onChatKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      say(e)
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
        <input
          type="text"
          onKeyDown={onChatKeydown}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => {
            onFocusChange?.(false)
            isMobile() && resetMobileViewportLayout()
          }}
          value={currentMessage}
          onChange={(e: any) => setMessage(e.target.value)}
          ref={inputRef}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}

export class ChatSettings extends TypedEventTarget<{ changed: { enabled: boolean } }> {
  constructor() {
    super()
    const settings = this.getSavedSettings()
    if ('enabled' in settings) {
      this._enabled = !!settings.enabled
    }
  }

  private _enabled = true

  get enabled() {
    return this._enabled
  }

  set enabled(value: boolean) {
    this._enabled = value
    this.saveSettings({ enabled: value })
    this.dispatchEvent(createEvent('changed', { enabled: value }))
  }

  private getSavedSettings() {
    if (typeof localStorage === 'undefined') return {}
    try {
      return JSON.parse(localStorage.getItem('chat') || '{}') || {}
    } catch {
      return {}
    }
  }

  private saveSettings(settings: { enabled: boolean }) {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem('chat', JSON.stringify(settings))
  }
}

export const chatSettings = new ChatSettings()
