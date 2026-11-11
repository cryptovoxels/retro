import { expect, it, vi } from 'vitest'
import { Rats } from '../src/rats'
import type { MeshExtended } from '../src/features/feature'
import type { RatPose } from '../common/messages'
import { decode, encode, MessageType } from '../common/messages'

vi.mock('../web/src/state', () => ({ app: { state: { wallet: 'test' } } }))

vi.mock('../src/mono-pool', () => ({
  runCompute: async (run: any) => {
    const { readFileSync } = await import('node:fs')
    const { loadVox } = await import('../src/monoworker/vox')
    return run({ loadVox: ({ url, ...args }: any) => loadVox({ ...args, buffer: Uint8Array.from(readFileSync('dist/models/critters/' + new URL(url).pathname.split('/').pop())).buffer }) })
  },
}))

it('renders the same rat on the next snapshot and clears the street on exit', async () => {
  const scene = new BABYLON.Scene(new BABYLON.NullEngine())
  const rats = new Rats(scene, vi.fn())
  const pose: RatPose = [1, 111.25, 0.74, -1057.75, false, 'Dave-o', null, true]
  const msg = decode(encode({ type: MessageType.worldState, avatars: [], rats: [pose] }))
  if (msg.type !== 'success' || msg.message.type !== MessageType.worldState) throw Error('world state')
  try {
    rats.update(msg.message.rats!)
    const body = scene.getTransformNodeByName('rat-1')
    expect(body?.position.x).toBe(pose[1])
    await vi.waitFor(() => expect(scene.getMeshByName('rat body')).toBeTruthy())
    expect(scene.getMeshByName('rat body')!.isVerticesDataPresent(BABYLON.VertexBuffer.ColorKind)).toBe(true)
    const bounds = scene.getMeshByName('rat body')!.getBoundingInfo().boundingBox
    scene.getMeshByName('rat body')!.computeWorldMatrix(true)
    expect(bounds.maximumWorld.y - bounds.minimumWorld.y).toBeCloseTo(0.34, 2)
    expect((scene.getMeshByName('rat body') as MeshExtended).cvOnLeftClick).toBeTypeOf('function')
    await vi.waitFor(() => expect(scene.getMeshByName('red cap')?.isEnabled()).toBe(true))
    pose[1]++
    pose[4] = true
    rats.update([pose])
    expect(scene.getTransformNodeByName('rat-1')).toBe(body)
    expect(scene.getMeshByName('chip')?.isEnabled()).toBe(true)
    rats.update([])
    expect(scene.meshes.some((m) => m.isEnabled())).toBe(false)
  } finally {
    scene.getEngine().dispose()
  }
})

it('keeps the eagle flying while its prey disappears and respawns', async () => {
  const scene = new BABYLON.Scene(new BABYLON.NullEngine())
  const animals = new Rats(scene, vi.fn())
  const eagle: RatPose = [4, 111, 7, -1058, false, 'henry', null, false, 'eagle']
  const rat: RatPose = [1, 111, 0.74, -1058, false, 'Dave-o', null, true]
  try {
    eagle[9] = ['cleaning', 0, 0.7, [0, 0.02, 0], [0.2, 0.4, 0.1]]
    animals.update([eagle, rat])
    const henry = scene.getTransformNodeByName('henry')
    expect(henry).toBeTruthy()
    await vi.waitFor(() => expect(scene.getMeshByName('wing')).toBeTruthy())
    expect(henry?.getChildMeshes().filter((m) => m.name === 'wing')).toHaveLength(2)
    vi.spyOn(scene.getEngine(), 'getDeltaTime').mockReturnValue(62.5)
    scene.onBeforeRenderObservable.notifyObservers(scene)
    const idle = henry!.getChildTransformNodes(true)[0]
    expect(henry!.position.y).toBe(7)
    expect(henry!.rotation.y).toBeCloseTo(0.35)
    expect(idle.position.y).toBeCloseTo(0.01)
    expect(idle.rotation.x).toBeCloseTo(0.1)
    animals.update([eagle])
    expect(scene.getTransformNodeByName('rat-1')).toBeNull()
    animals.update([eagle, rat])
    expect(scene.getTransformNodeByName('henry')).toBe(henry)
    await vi.waitFor(() => expect(scene.getMeshByName('red cap')?.isEnabled()).toBe(true))
    animals.update([])
  } finally {
    scene.getEngine().dispose()
  }
})
