import { describe, expect, it, vi } from 'vitest'
import { Footsteps } from '../src/audio/footsteps'
import { TransformQueue } from '../src/utils/transform'
import { decode, encode, MessageType, UpdateAvatarMessage } from '../common/messages'

function makeSteps() {
  const sound = { isReady: () => true, play: vi.fn(), setVolume: vi.fn(), setPlaybackRate: vi.fn(), dispose: vi.fn() }
  return { sound, steps: new Footsteps(sound as any) }
}

describe('footsteps', () => {
  it.each([6.9, 24])('keeps the same cadence at 30, 60 and 144 FPS at %s m/s', (speed) => {
    const counts = [30, 60, 144].map((fps) => {
      const { steps, sound } = makeSteps()
      for (let i = 0; i < fps * 10; i++) steps.update(speed / fps, 1 / fps)
      return sound.play.mock.calls.length
    })
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    expect(counts[0]).toBeGreaterThan(speed === 24 ? 40 : 28)
  })

  it('plays one immediate footfall for a short step, with no settling clack', () => {
    const { steps, sound } = makeSteps()
    for (let i = 0; i < 8; i++) steps.update(0.05, 1 / 60)
    for (let i = 0; i < 120; i++) steps.update(0, 1 / 60)
    expect(sound.play).toHaveBeenCalledTimes(1)
    expect(sound.play).toHaveBeenCalledWith(0, 0, 0.125)
  })

  it('drops teleports and hitches without catching up', () => {
    const { steps, sound } = makeSteps()
    steps.update(100, 1 / 60)
    steps.update(6.9, 1)
    expect(sound.play).not.toHaveBeenCalled()
    steps.update(0.1, 1 / 60)
    expect(sound.play).toHaveBeenCalledTimes(1)
  })

  it('does not debounce a landing after a step', () => {
    const { steps, sound } = makeSteps()
    steps.update(0.1, 1 / 60)
    steps.land(6)
    expect(sound.play).toHaveBeenLastCalledWith(0, 0.5, 0.125)
    expect(sound.play).toHaveBeenCalledTimes(2)
    steps.update(0.1, 1 / 60)
    expect(sound.play).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])('round-trips grounded=%s over multiplayer', (grounded) => {
    const message: UpdateAvatarMessage = {
      type: MessageType.updateAvatar,
      uuid: '11111111-1111-4111-8111-111111111111',
      animation: 2,
      grounded,
      position: [1, 2, 3],
      orientation: [0, 0, 0, 1],
    }
    const result = decode(encode(message))
    expect(result.type).toBe('success')
    if (result.type === 'success') expect((result.message as UpdateAvatarMessage).grounded).toBe(grounded)
  })

  it('keeps remote footsteps off across airborne interpolation', () => {
    const queue = new TransformQueue(200)
    const transform = { animation: 2, orientation: BABYLON.Quaternion.Identity(), position: BABYLON.Vector3.Zero() }
    queue.add({ ...transform, timestamp: 100, grounded: true })
    queue.add({ ...transform, timestamp: 300, grounded: false })
    queue.add({ ...transform, timestamp: 500, grounded: true })
    expect(queue.get(200)?.grounded).toBe(false)
    expect(queue.get(400)?.grounded).toBe(false)
    expect(queue.get(500)?.grounded).toBe(true)
  })
})
