import { expect, it, vi } from 'vitest'
import { Footsteps } from '../src/audio/footsteps'
import PlayerBody from '../src/controls/utils/player-body'
import { addCuboid, initPhysics, physics, removeCollider, stepPhysics } from '../src/physics/world'

it('reports grounding, takeoff and one landing impact', async () => {
  await initPhysics()
  addCuboid('footstep-floor', { x: 20, y: 0.5, z: 20 }, { x: 0, y: -0.5, z: 0 })
  const body = new PlayerBody()
  body.flying = false
  body.position.y = 3
  const move = { x: 0, y: 0, z: 0 }
  const tick = () => {
    body.step(move, 1 / 60)
    stepPhysics(1 / 60)
  }
  try {
    for (let i = 0; i < 180; i++) tick()
    expect(body.grounded).toBe(true)
    const floor = body.position.y
    body.jump()
    expect(body.grounded).toBe(false)
    let peak = floor
    let impacts = 0
    for (let i = 0; i < 180; i++) {
      tick()
      peak = Math.max(peak, body.position.y)
      if (body.motion.impact > 2) impacts++
    }
    expect(peak - floor).toBeGreaterThan(1)
    expect(impacts).toBe(1)
    expect(body.grounded).toBe(true)
    const sound = { isReady: () => true, play: vi.fn(), setVolume: vi.fn(), setPlaybackRate: vi.fn() }
    const steps = new Footsteps(sound as any)
    move.x = 1
    for (let i = 0; i < 120; i++) {
      const x = body.position.x
      tick()
      if (body.grounded) steps.update(body.position.x - x, 1 / 60)
      else steps.reset()
    }
    expect(sound.play.mock.calls.length).toBeGreaterThanOrEqual(7)
    expect(sound.play.mock.calls.length).toBeLessThanOrEqual(9)
  } finally {
    if (body.blocker) physics()!.removeRigidBody(body.blocker)
    removeCollider('footstep-floor')
  }
})
