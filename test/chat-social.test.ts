import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { v7 } from 'uuid'
import { chatName, chatTime, mergeChat } from '../common/utils'
import { messageList } from '../src/connector'
import { ChatPanel, ChatSettings } from '../src/ui/interact/chat'
import { Client } from '../multiplayer/src/ws/client'

vi.mock('../src/connector', async () => {
  const { signal } = await import('@preact/signals')
  return { messageList: signal([]) }
})
vi.mock('../web/src/state', () => ({ app: { state: {}, isAdmin: () => false } }))
vi.mock('../src/ui/interact/popout', () => ({ InteractPopout: () => null }))
vi.mock('../web/src/components/icons/interact', () => ({ default: () => null }))
vi.mock('../src/controls/mobile/controls', () => ({ resetMobileViewportLayout: () => {} }))
vi.mock('../web/src/shard-chat', () => ({ sendChat: () => true }))
vi.mock('../common/helpers/detector', () => ({ isMobile: () => true }))
vi.mock('../src/hate', () => ({ isHate: () => false }))
vi.mock('../src/obscenity', () => ({ matcher: { getAllMatches: () => [] } }))
vi.mock('../web/src/components/snackbar', () => ({ snack: { value: null } }))

let root: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T00:00:00Z'))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  root = document.createElement('div')
  document.body.append(root)
  messageList.value = []
})
afterEach(() => {
  act(() => render(null, root))
  root.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('names remain readable for named, wallet, email and guest accounts', () => {
  expect(chatName({ name: 'Paula', owner: '0x123', id: 1, created_at: '' })).toBe('Paula')
  expect(chatName('01a170dc-a81e-7d9c-87bf-7d40b0b42f6a')).toBe('guest b42f6a')
  expect(chatName('guest:abcdef')).toBe('guest abcdef')
  expect(chatName('anon', '123456abcdef')).toBe('guest abcdef')
  expect(chatName('0x123456789abcdef')).toBe('0x12345678...')
})

test('history keeps its original time and merges without losing live arrivals', () => {
  const id = v7({ msecs: Date.now() - 60_000 })
  expect(chatTime(id)).toBe(Date.now() - 60_000)
  expect(chatTime()).toBe(0)
  expect(mergeChat([{ id: 'old' }, { id: 'overlap' }], [{ id: 'overlap' }, { id: 'live' }])).toEqual([{ id: 'old' }, { id: 'overlap' }, { id: 'live' }])
})

test('mobile shows three recent messages, names, then fades and removes them', () => {
  messageList.value = Array.from({ length: 5 }, (_, i) => ({ id: String(i), avatar: undefined, avatarRef: 'guest:abc123', text: `message ${i}`, timestamp: Date.now() }))
  act(() => render(h(ChatPanel, { cap: 10, variant: 'overlay' }), root))
  expect(root.querySelectorAll('.chat-messages p')).toHaveLength(3)
  expect(root.textContent).not.toContain('message 0')
  expect(root.querySelector('.chat-who')?.textContent).toBe('guest abc123')
  act(() => {
    vi.advanceTimersByTime(15_000)
  })
  expect(root.querySelectorAll('.chat-messages p.faded')).toHaveLength(3)
  act(() => {
    vi.advanceTimersByTime(3_000)
  })
  expect(root.querySelectorAll('.chat-messages p')).toHaveLength(0)
})

test('chat starts enabled but preserves an explicit opt out', () => {
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) })
  expect(new ChatSettings().enabled).toBe(true)
  localStorage.setItem('chat', '{"enabled":false}')
  expect(new ChatSettings().enabled).toBe(false)
  localStorage.removeItem('chat')
})

test('opening chat scrolls to newest, but arrivals do not pull you out of history', () => {
  act(() => render(h(ChatPanel, { cap: 1000 }), root))
  const box = root.querySelector('.chat-messages') as HTMLDivElement
  Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(box, 'clientHeight', { value: 100 })
  act(() => {
    messageList.value = [{ id: 'a', avatar: undefined, text: 'first', timestamp: 1 }]
  })
  expect(box.scrollTop).toBe(1000)
  box.scrollTop = 100
  act(() => {
    box.dispatchEvent(new Event('scroll'))
  })
  act(() => {
    messageList.value = [...messageList.value, { id: 'b', avatar: undefined, text: 'second', timestamp: 2 }]
  })
  expect(box.scrollTop).toBe(100)
})

test('reconnecting broadcasters cannot repeat an identical live invite for ten minutes', () => {
  const shard: any = { id: 'test', recentChat: [], broadcastFromClient: vi.fn() }
  const first: any = new Client('first' as any, {} as any, {} as any, '', shard)
  const second: any = new Client('second' as any, {} as any, {} as any, '', shard)
  const msg: any = { type: 0, uuid: 'first', text: 'Paula is live at Gallery. [[show:N@1E]]' }
  first.handleChat(msg)
  second.handleChat(msg)
  expect(shard.broadcastFromClient).toHaveBeenCalledTimes(1)
  second.handleChat({ ...msg, text: 'hello' })
  second.handleChat({ ...msg, text: 'hello' })
  expect(shard.broadcastFromClient).toHaveBeenCalledTimes(3)
  vi.advanceTimersByTime(600_001)
  second.handleChat(msg)
  expect(shard.broadcastFromClient).toHaveBeenCalledTimes(4)
})
