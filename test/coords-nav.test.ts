import { beforeEach, expect, test, vi } from 'vitest'
import { naviportHere } from '../web/src/helpers/coords-nav'

vi.mock('../web/src/client', () => ({ worldBoot: vi.fn().mockResolvedValue(null) }))

beforeEach(() => {
  window.persona = { teleport: vi.fn() } as any
  window.grid = { switchWorld: vi.fn().mockResolvedValue(undefined) } as any
})

test('explicit travel waits for the world and teleports once', async () => {
  let ready!: () => void
  vi.mocked(window.grid!.switchWorld).mockReturnValue(new Promise<void>((resolve) => (ready = resolve)))
  const travel = naviportHere('10E,20N', 'space-one')
  await vi.waitFor(() => expect(window.grid!.switchWorld).toHaveBeenCalled())
  expect(window.persona.teleport).not.toHaveBeenCalled()
  ready()
  await travel
  expect(window.persona.teleport).toHaveBeenCalledTimes(1)
  expect(window.persona.teleport).toHaveBeenCalledWith(expect.objectContaining({ position: new BABYLON.Vector3(10, 2.5, 20) }), false)
})

test('a newer destination supersedes a pending move', async () => {
  let ready!: () => void
  vi.mocked(window.grid!.switchWorld).mockReturnValueOnce(new Promise<void>((resolve) => (ready = resolve)))
  const first = naviportHere('10E,20N')
  await vi.waitFor(() => expect(window.grid!.switchWorld).toHaveBeenCalledTimes(1))
  await naviportHere('30E,40N')
  ready()
  await first
  expect(window.persona.teleport).toHaveBeenCalledTimes(1)
  expect(window.persona.teleport).toHaveBeenCalledWith(expect.objectContaining({ position: new BABYLON.Vector3(30, 2.5, 40) }), false)
})
