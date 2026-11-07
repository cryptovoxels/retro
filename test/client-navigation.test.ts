import { beforeEach, expect, test, vi } from 'vitest'
import { Client } from '../web/src/client'

vi.mock('../src', () => ({ bootEngine: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/init/realm', () => ({ realmSavedCoords: vi.fn(), saveRealmCoords: vi.fn() }))
vi.mock('../src/store', () => ({ currentOrNearestParcel: { value: null } }))
vi.mock('../src/utils/loading-done', () => ({ markLoaded: vi.fn() }))
vi.mock('../common/helpers/detector', () => ({ wantsNoUI: () => true }))
vi.mock('../common/helpers/parcel-helper', () => ({
  default: class {
    spawnCoords = '10E,20N'
  },
}))
vi.mock('../web/src/helpers/cached-fetch', () => ({ default: vi.fn().mockResolvedValue({ json: async () => ({ parcel: { id: 42 } }) }) }))

beforeEach(() => {
  history.replaceState(null, '', '/')
  window.persona = { teleport: vi.fn() } as any
  window.grid = { currentW: 0, switchWorld: vi.fn().mockResolvedValue(undefined), currentParcel: () => null } as any
  window.engine = { resize: vi.fn() } as any
})

test('entering /play after the engine writes coords does not move the avatar', async () => {
  const client = new Client({ path: '/play' })
  history.replaceState('10E,20N', '', '/play?coords=10E,20N')
  client.componentDidUpdate({ path: '/' })
  await Promise.resolve()
  expect(window.persona.teleport).not.toHaveBeenCalled()
  expect(window.grid!.switchWorld).not.toHaveBeenCalled()
})

test('Back restores URL coords once, ignoring legacy object history state', async () => {
  history.replaceState(null, '', '/play')
  const client = new Client({ path: '/play' })
  client.componentDidMount()
  await vi.waitFor(() => expect(window.grid!.switchWorld).toHaveBeenCalled())
  vi.mocked(window.grid!.switchWorld).mockClear()
  history.replaceState({ realm: 'space' }, '', '/play?coords=10E,20N')
  window.dispatchEvent(new PopStateEvent('popstate', { state: { realm: 'space' } }))
  await vi.waitFor(() => expect(window.persona.teleport).toHaveBeenCalledTimes(1))
  expect(window.persona.teleport).toHaveBeenCalledWith(expect.objectContaining({ position: new BABYLON.Vector3(10, 2.5, 20) }), false)
  client.componentWillUnmount()
})

test('visiting a parcel explicitly requests movement', async () => {
  history.replaceState(null, '', '/parcels/42')
  const client = new Client({ path: '/parcels/42' })
  client.componentDidUpdate({ path: '/play' })
  await vi.waitFor(() => expect(window.persona.teleport).toHaveBeenCalledTimes(1))
})
