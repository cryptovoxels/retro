import { expect, it, vi } from 'vitest'
import { Critters } from '../src/critters'
import type { CritterPose } from '../common/messages'
import { decode, encode, MessageType } from '../common/messages'

vi.mock('../src/mono-pool', () => ({
  runCompute: async (run: any) => {
    const { readFileSync } = await import('node:fs')
    const { loadVox } = await import('../src/monoworker/vox')
    return run({ loadVox: ({ url, ...args }: any) => loadVox({ ...args, buffer: Uint8Array.from(readFileSync('dist/models/critters/' + new URL(url).pathname.split('/').pop())).buffer }) })
  },
}))

it('uses the same movement packet for wings and tails and removes sleeping critters', async () => {
  const scene = new BABYLON.Scene(new BABYLON.NullEngine())
  const animals = new Critters(scene)
  const poses: CritterPose[] = [
    [1, 'rat', [11, 2, 4], [0, 0, 0], 0],
    [2, 'eagle', [10, 8, 4], [0, 0, 0], 0],
  ]
  try {
    const msg = decode(encode({ type: MessageType.worldState, avatars: [], critters: poses }))
    if (msg.type !== 'success' || msg.message.type !== MessageType.worldState) throw Error('world state')
    animals.update(msg.message.critters!)
    await vi.waitFor(() => expect(scene.getMeshByName('leftwing')).toBeTruthy())
    const body = scene.getTransformNodeByName('rat-1')
    poses[0][2][0]++
    for (const pose of poses) {
      pose[3][1] = 1
      pose[4] = Math.PI / 2
    }
    animals.update(poses)
    vi.spyOn(scene.getEngine(), 'getDeltaTime').mockReturnValue(125)
    scene.onBeforeRenderObservable.notifyObservers(scene)
    expect(body?.position.x).toBe(12)
    expect(body?.rotation.y).toBe(1)
    expect(scene.getTransformNodeByName('tail')?.rotation.y).toBeCloseTo(0.22)
    expect(scene.getTransformNodeByName('leftwing')?.rotation.z).toBeCloseTo(-0.35)
    animals.update([])
    expect(scene.getTransformNodeByName('rat-1')).toBeNull()
    expect(scene.getTransformNodeByName('eagle-2')).toBeNull()
  } finally {
    scene.getEngine().dispose()
  }
})
