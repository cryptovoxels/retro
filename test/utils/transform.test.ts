import { expect, test } from 'vitest'
import { TransformQueue } from '../../src/utils/transform'

const pos = (queue: TransformQueue, t: number) => queue.get(t)?.position.asArray()

test('transform queue adding and length', () => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const queue = new TransformQueue(100)
  queue.add({ animation: 0, timestamp: 100, orientation: q.clone(), position: v.clone() })
  expect(queue.length, 'first added goes into current').toBe(0)
  queue.add({ animation: 0, timestamp: 200, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, timestamp: 300, orientation: q.clone(), position: v.clone() })
  expect(queue.length).toBe(2)
})

test('transform clear and find', () => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const queue = new TransformQueue(100)
  queue.add({ animation: 0, timestamp: 100, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, timestamp: 200, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, timestamp: 300, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, timestamp: 400, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, timestamp: 500, orientation: q.clone(), position: v.clone() })
  expect(queue.length).toBe(4)

  queue.clear(100) // the first object added should have moved to the current, so a no op
  expect(queue.length).toBe(4)

  let next = queue.clear(200)
  expect(queue.length).toBe(3)
  expect(next?.timestamp).toBe(200)

  next = queue.clear(299)
  expect(queue.length).toBe(3)
  expect(next?.timestamp).toBe(undefined)

  next = queue.clear(420)
  expect(queue.length).toBe(1)
  expect(next?.timestamp).toBe(400)
})

test('transform interpolation', () => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const queue = new TransformQueue(100)

  expect(queue.get(100)).toBe(null)
  queue.add({ animation: 0, timestamp: 100, orientation: q, position: v.clone().set(1, 1, 1) })
  expect(queue.get(50)).toBe(null)
  expect(pos(queue, 110)).toEqual([1, 1, 1])

  queue.add({ animation: 0, timestamp: 200, orientation: q, position: v.clone().set(2, 2, 2) })
  queue.add({ animation: 0, timestamp: 300, orientation: q, position: v.clone().set(4, 4, 4) })
  queue.add({ animation: 0, timestamp: 400, orientation: q, position: v.clone().set(5, 5, 5) })
  queue.add({ animation: 0, timestamp: 500, orientation: q, position: v.clone().set(6, 6, 6) })

  expect(pos(queue, 110)).toEqual([1.1, 1.1, 1.1])
  expect(pos(queue, 190)).toEqual([1.9, 1.9, 1.9])
  expect(pos(queue, 200)).toEqual([2.0, 2.0, 2.0])
  expect(pos(queue, 450)).toEqual([5.5, 5.5, 5.5])
})

test('transform teleportation', () => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const MAX_VELOCITY = 99
  const queue = new TransformQueue(100, MAX_VELOCITY)

  queue.add({ animation: 0, timestamp: 0, orientation: q, position: v.clone().set(0, 0, 0) })
  queue.add({ animation: 0, timestamp: 100, orientation: q, position: v.clone().set(10, 0, 0) })

  // normally we would expect the position to between 10% between 0 and 10, but since we are moving so fast we are going
  // to 'teleport' to the last position instead of interpolating. This either indicates a server/client lag or an actual
  // teleportation or jump. The velocity is moving 10 meters per 100ms which equals to 100m/sec, which is faster than the
  // MAX_VELOCITY of 99
  expect(pos(queue, 10)).toEqual([10.0, 0.0, 0.0])
  expect(queue.length).toBe(1)
})

test('transform test few updates interpolation', () => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const queue = new TransformQueue(100)

  queue.add({ animation: 0, timestamp: 100, orientation: q, position: v.clone().set(1, 1, 1) })
  queue.add({ animation: 0, timestamp: 1000, orientation: q, position: v.clone().set(2, 2, 2) })

  expect(pos(queue, 900)).toEqual([1.0, 1.0, 1.0])
  expect(pos(queue, 950)).toEqual([1.5, 1.5, 1.5])
})
