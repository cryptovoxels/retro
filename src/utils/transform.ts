import { Animations } from '../avatar-animations'
import { Quat, Vec3 } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'

export interface Transform {
  timestamp: number
  position: Vec3
  orientation: Quat
  animation: Animations
}

export class TransformQueue {
  private readonly interpolationTickMs: number
  // do avoid doing unnecessary divides in tight loops
  private readonly interpolationTickSec: number
  private hasCurrent = false
  private readonly maxVelocity: number

  private current: Transform = {
    animation: 0,
    position: vec3.create(),
    orientation: quat.create(),
    timestamp: 0,
  }
  // a queue with the transform sorted with the oldest client_ts at a higher index (front loaded)
  private queue: Transform[] = []

  constructor(interpolationTick: number, maxVelocity = 0) {
    this.maxVelocity = maxVelocity
    this.interpolationTickMs = interpolationTick
    this.interpolationTickSec = this.interpolationTickMs / 1000
  }

  get length() {
    return this.queue.length
  }

  add(transform: Transform) {
    if (this.hasCurrent) this.queue.push(transform)
    else this.setCurrent(transform)
  }

  // loop through the queue and remove all the transforms that are older than the current timestamp

  // return the last removed transform
  clear(ts: number): Transform | null {
    const remaining = []
    let lastRemoved: Transform | null = null
    for (const t of this.queue) {
      if (ts >= t.timestamp) {
        lastRemoved = t
      } else {
        remaining.push(t)
      }
    }
    this.queue = remaining
    return lastRemoved
  }

  next(ts: number) {
    return this.queue.find((t) => ts < t.timestamp)
  }

  amount(from: Transform, to: Transform, now: number) {
    return Math.max(0, Math.min((now - from.timestamp) / (to.timestamp - from.timestamp), 1))
  }

  get(now: number): Transform | null {
    let current = this.clear(now)
    if (current) {
      this.setCurrent(current)
    } else {
      current = this.getCurrent(now)
    }

    const to = this.next(now)
    if (!to || !current) {
      return current
    }

    const t = {
      animation: to.animation,
      timestamp: now,
      orientation: to.orientation,
      position: to.position,
    }

    if (this.maxVelocity > 0) {
      const distance = vec3.distance(current.position, to.position)
      // meter per second
      const velocity = distance / this.interpolationTickSec
      // check if the avatar needs to be placed directly because it's teleporting or being so badly behind
      // note that the limit should be faster than a character can move / run
      if (velocity > this.maxVelocity) {
        return t
      }
    }

    // prevent weird interpolation happening when we haven't got an update over a tick we
    // pretend that it has been expectedTickRate ms since we moved
    if (to.timestamp - current.timestamp > this.interpolationTickMs) {
      this.current.timestamp = current.timestamp = to.timestamp - this.interpolationTickMs
    }

    // ratio between 0.0 - 1.0 describing where between `from` and `to` the avatar should be
    const ratio = this.amount(current, to, now)
    if (ratio === 0 || !ratio) {
      return current
    }

    t.orientation = quat.slerp(current.orientation, to.orientation, ratio)
    t.position = vec3.lerp(current.position, to.position, ratio)
    return t
  }

  private setCurrent(t: Transform) {
    this.current.animation = t.animation
    this.current.timestamp = t.timestamp
    this.current.orientation.copyFrom(t.orientation)
    this.current.position.copyFrom(t.position)
    this.hasCurrent = true
  }

  private getCurrent(now: number): Transform | null {
    if (!this.hasCurrent) {
      return null
    }
    return this.current.timestamp <= now ? this.current : null
  }
}
