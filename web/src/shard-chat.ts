import { v7 as uuid } from 'uuid'
import Cookies from 'js-cookie'
import { avatarName, type AvatarRef } from '../../common/messages/avatar-ref'
import * as messages from '../../common/messages'
import { messageList, type ChatMessageRecord } from '../../src/connector'
import { track } from './helpers/umami'
import { app } from './state'

const clientUUID = uuid()

function avatarLineName(avatar?: AvatarRef): string {
  if (!avatar) return 'anon'
  if (typeof avatar === 'object') return avatar.name || 'anon'
  const n = avatarName(avatar)
  return n === '...' ? 'anon' : n
}

/** Plain who/text for a messageList entry (broadcast dock and other non-ChatPanel views). */
export function chatLine(m: ChatMessageRecord): { who: string; text: string } {
  let who = m.avatarRef ? avatarLineName(m.avatarRef) : ''
  if (!who || who === 'anon') {
    const avatar = m.avatar ? (window as any).connector?.findAvatar(m.avatar) : null
    who = avatar?.name || who || 'anon'
  }
  return { who, text: entityDecode(m.text) }
}

let converter: HTMLTextAreaElement | null = null

function entityEncode(str: string) {
  if (!converter) converter = document.createElement('textarea')
  converter.innerText = str
  return converter.innerHTML
}

function entityDecode(str: string) {
  if (!converter) converter = document.createElement('textarea')
  converter.innerHTML = str
  return converter.value
}

/** Feed ChatPanel when the world connector is not mounted (/chat without coords). */
function pushMessageList(text: string, avatarRef?: AvatarRef, id?: string, moderated?: boolean) {
  if ((window as any).connector) return
  const list = messageList.value.slice()
  list.push({ id, moderated, avatar: undefined, avatarRef: avatarRef ?? 'anon', text, timestamp: Date.now() })
  while (list.length > 1000) list.shift()
  messageList.value = list
}

function socketUrl() {
  if (process.env.NODE_ENV === 'development') {
    return `ws://localhost:3780/socket?client_uuid=${clientUUID}`
  }
  const url = new URL(window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/mp/socket'
  url.search = `?client_uuid=${clientUUID}`
  url.hash = ''
  return url.toString()
}

let ws: WebSocket | null = null

function send(message: messages.Message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  try {
    ws.send(messages.encode(message))
  } catch {}
}

export function connectShardChat() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws

  // clear before open so a fast Send is not wiped by history setup
  if (!(window as any).connector) messageList.value = []

  void fetchChatHistory()

  ws = new WebSocket(socketUrl())
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    const key = app.state.key || Cookies.get('jwt')
    if (!key) return
    send({ type: messages.MessageType.login, token: key })
  }

  ws.onmessage = (ev) => {
    try {
      const raw = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data
      const result = messages.decode(raw)
      if (result.type !== 'success' || !result.message) return
      if (result.message.type !== messages.MessageType.chat) return
      const m = result.message
      pushMessageList(entityDecode(m.text), m.avatar ?? avatarLineName(m.avatar), m.id, m.moderated)
    } catch {}
  }

  ws.onclose = () => {
    ws = null
  }

  return ws
}

async function fetchChatHistory() {
  if ((window as any).connector) return
  try {
    const res = await fetch('/api/chat.json', { cache: 'no-store' })
    const data = await res.json()
    const list: typeof messageList.value = []
    for (const m of data.messages ?? []) {
      list.push({
        id: m.id,
        moderated: m.moderated,
        avatar: undefined,
        avatarRef: m.avatar ?? avatarLineName(m.avatar),
        text: entityDecode(m.text),
        timestamp: Date.now(),
      })
    }
    // history under any live lines that arrived during the fetch
    const merged = [...list, ...messageList.value]
    while (merged.length > 1000) merged.shift()
    messageList.value = merged
  } catch {}
}

export function disconnectShardChat() {
  try {
    ws?.close()
  } catch {}
  ws = null
}

export function sendChat(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (!ws || ws.readyState !== WebSocket.OPEN) connectShardChat()
  // mp publish skips the sender - show our line locally so reply feels instant
  // (in-world the connector's own socket gets the echo, so pushMessageList is a no-op there)
  pushMessageList(trimmed, (app.state.name || '').trim() || 'anon')
  send({
    type: messages.MessageType.chat,
    id: '',
    uuid: clientUUID,
    text: trimmed,
  })
  track('chat')
  return true
}

export function announceShowLive(hostName: string, location: string, encodedCoords: string) {
  const name = hostName.trim()
  const coords = encodedCoords.trim()
  if (!name || !coords) return
  send({
    type: messages.MessageType.chat,
    id: '',
    uuid: clientUUID,
    text: entityEncode(`${name} is live at ${location}. [[show:${coords}]]`),
  })
}
