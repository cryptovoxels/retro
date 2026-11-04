import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, test, vi } from 'vitest'
import Teleport from '../web/src/components/teleport'
import cachedFetch from '../web/src/helpers/cached-fetch'
import { naviportHere } from '../web/src/helpers/coords-nav'

vi.mock('../web/src/helpers/cached-fetch', () => ({ default: vi.fn() }))
vi.mock('../web/src/helpers/coords-nav', () => ({ naviportHere: vi.fn() }))
vi.mock('../web/src/store', () => ({ wompCache: { get: () => null } }))
vi.mock('../common/helpers/parcel-helper', () => ({
  default: class {
    spawnCoords = '10E,20N'
  },
}))

const root = document.createElement('div')
const switchWorld = vi.fn().mockResolvedValue(undefined)

afterEach(() => {
  render(null, root)
  vi.clearAllMocks()
})

function clickLink(href: string, options: MouseEventInit = {}) {
  window.grid = { switchWorld } as any
  const link = h('a', { href }, h('span', {}, 'go'))
  const table = h('table', {}, h('tbody', {}, h('tr', {}, h('td', {}, link))))
  render(h(Teleport, { children: table }), root)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options })
  let prevented = true
  const navigation = (e: Event) => {
    prevented = e.defaultPrevented
    e.preventDefault()
  }
  root.addEventListener('click', navigation)
  root.querySelector('span')!.dispatchEvent(event)
  root.removeEventListener('click', navigation)
  return { defaultPrevented: prevented }
}

test('nested parcel links teleport without reaching the router', async () => {
  vi.mocked(cachedFetch).mockResolvedValue({ json: async () => ({ parcel: { id: 42 } }) } as any)
  const router = vi.fn()
  root.addEventListener('click', router)
  await act(async () => {
    expect(clickLink('/parcels/42').defaultPrevented).toBe(true)
  })
  expect(router).not.toHaveBeenCalled()
  expect(switchWorld).toHaveBeenCalledWith(0, undefined, '10E,20N')
  await vi.waitFor(() => expect(naviportHere).toHaveBeenCalledWith('10E,20N'))
  root.removeEventListener('click', router)
})

test('space womps switch worlds and keep the page in place', async () => {
  vi.mocked(cachedFetch).mockResolvedValue({ json: async () => ({ womp: { coords: '5E,6N', space_id: 'space-one' } }) } as any)
  await act(async () => {
    expect(clickLink('/womps/7').defaultPrevented).toBe(true)
  })
  expect(switchWorld).toHaveBeenCalledWith(expect.any(Number), 'space-one', '5E,6N')
  await vi.waitFor(() => expect(naviportHere).toHaveBeenCalledWith('5E,6N'))
})

test('modified clicks and unrelated links keep normal navigation', () => {
  expect(clickLink('/parcels/42', { ctrlKey: true }).defaultPrevented).toBe(false)
  expect(clickLink('/womps').defaultPrevented).toBe(false)
  expect(clickLink('https://example.com/parcels/42').defaultPrevented).toBe(false)
  expect(cachedFetch).not.toHaveBeenCalled()
  expect(switchWorld).not.toHaveBeenCalled()
})
