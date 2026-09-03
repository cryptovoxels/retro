import type { FreeCamera } from '@babylonjs/lite'
import PlayerBody, { RUN, WALK } from '../controls/utils/player-body'
import type { Vec3 } from '../physics/world'

export type LiteControls = ReturnType<typeof liteControls>

// desktop only: pointer lock + wasd. same sensitivity convention as babylon (higher = less sensitive)
export function liteControls(canvas: HTMLCanvasElement, body: PlayerBody, cam: FreeCamera, yaw: number) {
  const sens = parseFloat(localStorage.getItem('mouse_sensitivity') || '') || 500
  const keys = new Set<string>()
  const move: Vec3 = { x: 0, y: 0, z: 0 }
  const down = (...codes: string[]) => codes.some((c) => keys.has(c))

  body.flying = false
  // no colliders yet: grid flips this on when the first parcel has generated
  body.gravity = false

  canvas.addEventListener('click', () => canvas.requestPointerLock())
  document.addEventListener('mousemove', (e) => {
    if (!document.pointerLockElement) return
    c.yaw += e.movementX / sens
    c.pitch = Math.max(-1.5, Math.min(1.5, c.pitch + e.movementY / sens))
  })
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return
    keys.add(e.code)
    if (e.code === 'Space' && !e.repeat) body.jump()
  })
  document.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => keys.clear())

  const c = {
    yaw,
    pitch: 0,
    step(dt: number) {
      const f = +down('KeyW', 'ArrowUp') - +down('KeyS', 'ArrowDown')
      const r = +down('KeyD', 'ArrowRight') - +down('KeyA', 'ArrowLeft')
      const n = f && r ? Math.SQRT1_2 : 1
      const sy = Math.sin(c.yaw)
      const cy = Math.cos(c.yaw)
      move.x = (f * sy + r * cy) * n
      move.z = (f * cy - r * sy) * n
      body.speed = down('ShiftLeft', 'ShiftRight') ? RUN : WALK
      body.step(move, dt)

      const p = body.position
      const cp = Math.cos(c.pitch)
      cam.position.set(p.x, p.y, p.z)
      cam.target.set(p.x + sy * cp, p.y - Math.sin(c.pitch), p.z + cy * cp)
    },
  }
  return c
}
