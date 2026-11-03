import * as test from 'tape'
import { TransformQueue } from '../../src/utils/transform'

test('transform queue adding and length', (t) => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const queue = new TransformQueue(100)
  queue.add({ animation: 0, grounded: true, timestamp: 100, orientation: q.clone(), position: v.clone() })
  t.equals(queue.length, 0, 'first added goes into current')
  queue.add({ animation: 0, grounded: true, timestamp: 200, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, grounded: true, timestamp: 300, orientation: q.clone(), position: v.clone() })
  t.equals(queue.length, 2)
  t.end()
})

test('transform clear and find', (t) => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const queue = new TransformQueue(100)
  queue.add({ animation: 0, grounded: true, timestamp: 100, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, grounded: true, timestamp: 200, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, grounded: true, timestamp: 300, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, grounded: true, timestamp: 400, orientation: q.clone(), position: v.clone() })
  queue.add({ animation: 0, grounded: true, timestamp: 500, orientation: q.clone(), position: v.clone() })
  t.equals(queue.length, 4)

  queue.clear(100) // the first object added should have moved to the current, so a no op
  t.equals(queue.length, 4)

  let next = queue.clear(200)
  t.equals(queue.length, 3)
  t.equals(next?.timestamp, 200)

  next = queue.clear(299)
  t.equals(queue.length, 3)
  t.equals(next?.timestamp, undefined)

  next = queue.clear(420)
  t.equals(queue.length, 1)
  t.equals(next?.timestamp, 400)

  t.end()
})

test('transform interpolation', (t) => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const queue = new TransformQueue(100)

  t.equals(queue.get(100), null)
  queue.add({ animation: 0, grounded: true, timestamp: 100, orientation: q, position: v.clone().set(1, 1, 1) })
  t.equals(queue.get(50), null)
  t.deepEquals(queue.get(110)?.position, new BABYLON.Vector3(1, 1, 1))

  queue.add({ animation: 0, grounded: true, timestamp: 200, orientation: q, position: v.clone().set(2, 2, 2) })
  queue.add({ animation: 0, grounded: true, timestamp: 300, orientation: q, position: v.clone().set(4, 4, 4) })
  queue.add({ animation: 0, grounded: true, timestamp: 400, orientation: q, position: v.clone().set(5, 5, 5) })
  queue.add({ animation: 0, grounded: true, timestamp: 500, orientation: q, position: v.clone().set(6, 6, 6) })

  t.deepEquals(queue.get(110)?.position, new BABYLON.Vector3(1.1, 1.1, 1.1))
  t.deepEquals(queue.get(190)?.position, new BABYLON.Vector3(1.9, 1.9, 1.9))
  t.deepEquals(queue.get(200)?.position, new BABYLON.Vector3(2.0, 2.0, 2.0))
  t.deepEquals(queue.get(450)?.position, new BABYLON.Vector3(5.5, 5.5, 5.5))
  t.end()
})

test('transform teleportation', (t) => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const MAX_VELOCITY = 99
  const queue = new TransformQueue(100, MAX_VELOCITY)

  queue.add({ animation: 0, grounded: true, timestamp: 0, orientation: q, position: v.clone().set(0, 0, 0) })
  queue.add({ animation: 0, grounded: true, timestamp: 100, orientation: q, position: v.clone().set(10, 0, 0) })

  // normally we would expect the position to between 10% between 0 and 10, but since we are moving so fast we are going
  // to 'teleport' to the last position instead of interpolating. This either indicates a server/client lag or an actual
  // teleportation or jump. The velocity is moving 10 meters per 100ms which equals to 100m/sec, which is faster than the
  // MAX_VELOCITY of 99
  t.deepEquals(queue.get(10)?.position, new BABYLON.Vector3(10.0, 0.0, 0.0))
  t.equals(queue.length, 1)
  t.end()
})

test('transform test few updates interpolation', (t) => {
  const q = BABYLON.Quaternion.Zero()
  const v = BABYLON.Vector3.Zero()
  const queue = new TransformQueue(100)

  queue.add({ animation: 0, grounded: true, timestamp: 100, orientation: q, position: v.clone().set(1, 1, 1) })
  queue.add({ animation: 0, grounded: true, timestamp: 1000, orientation: q, position: v.clone().set(2, 2, 2) })

  t.deepEquals(queue.get(900)?.position, new BABYLON.Vector3(1.0, 1.0, 1.0))
  t.deepEquals(queue.get(950)?.position, new BABYLON.Vector3(1.5, 1.5, 1.5))

  t.end()
})
