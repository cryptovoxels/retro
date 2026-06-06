import { v7 as uuid } from 'uuid'
import Cookies from 'js-cookie'
import { signal } from '@preact/signals'
import { avatarName, type AvatarRef } from '../../common/messages/avatar-ref'
import * as messages from '../../common/messages'
import { app } from './state'

const clientUUID = uuid()

export type ShardChatLine = { text: string; uuid?: string; who?: string }

function chatLineName(avatar?: AvatarRef): string {
  if (!avatar) return 'anon'
  if (typeof avatar === 'object') return avatar.name || 'anon'
  const n = avatarName(avatar)
  return n === '...' ? 'anon' : n
}

export const chatMessages = signal<ShardChatLine[]>([])

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
      const text = entityDecode(m.text)
      const who = chatLineName(m.avatar)
      chatMessages.value = [...chatMessages.value, { text, uuid: m.uuid, who }]
    } catch {}
  }

  ws.onclose = () => {
    ws = null
  }

  return ws
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
  const who = (app.state.name || '').trim() || 'anon'
  // mp publish skips the sender - show our line locally so reply feels instant
  chatMessages.value = [...chatMessages.value, { text: trimmed, who }]
  send({
    type: messages.MessageType.chat,
    id: '',
    uuid: clientUUID,
    text: trimmed,
  })
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
