import RAPIER from '@dimforge/rapier3d-compat'
import { physics } from '../../physics/world'
import type PlayerBody from './player-body'
import { addToScene, createFreeCamera, FreeCamera, SceneContext, Vec3 } from '@babylonjs/lite'
import { attachForwardRay } from '../../utils/camera'
import { quat, vec3 } from 'wgpu-matrix'

const ORBIT_MARGIN = 0.3

// BJS Vector3-ish shim for cameraDirection / cameraRotation callers
function vecShim(v: Float32Array) {
  return {
    lengthSquared: () => vec3.lengthSq(v),
    scaleInPlace: (s: number) => {
      vec3.scale(s, v, v)
      return vecShim(v)
    },
    setAll: (n: number) => {
      v[0] = v[1] = v[2] = n
    },
    set: (x: number, y: number) => {
      v[0] = x
      v[1] = y
    },
  }
}

function rotShim(rot: { x: number; y: number; z: number }) {
  return {
    get x() {
      return rot.x
    },
    set x(v: number) {
      rot.x = v
    },
    get y() {
      return rot.y
    },
    set y(v: number) {
      rot.y = v
    },
    get z() {
      return rot.z
    },
    set z(v: number) {
      rot.z = v
    },
    clone: () => ({ x: rot.x, y: rot.y, z: rot.z }),
  }
}

// FreeCamera owns look direction. PlayerBody owns where the feet can go.
export default class PlayerCamera {
  /** lite camera registered on the scene */
  readonly cam: FreeCamera
  /** metres behind the eye; Controls eases this */
  distance = 0
  body: PlayerBody = undefined!
  private readonly scene: SceneContext
  private readonly _rotation = { x: 0, y: 0, z: 0 }
  private readonly _cameraDir = vec3.create()
  private readonly _cameraRot = vec3.create()
  private readonly back = vec3.create()
  readonly rotation = rotShim(this._rotation)
  readonly cameraDirection = vecShim(this._cameraDir)
  readonly cameraRotation = vecShim(this._cameraRot)
  // todo(lite): real camera input manager
  inputs = {
    attached: {} as Record<string, any>,
    add: (input: any) => {
      const key = input.getSimpleName?.() ?? 'input'
      this.inputs.attached[key] = input
      input.camera = this
      input.attachControl?.(true)
    },
    remove: (input: any) => {
      input.detachControl?.()
      const key = input.getSimpleName?.() ?? 'input'
      delete this.inputs.attached[key]
    },
    addGamepad: () => {},
  }

  constructor(name: string, position: Vec3, scene?: SceneContext, setActiveOnSceneIfNoneActive = true) {
    if (!scene) throw new Error('PlayerCamera needs a scene')
    this.scene = scene
    const p = position as any
    const pos = vec3.fromValues(p?.[0] ?? p?.x ?? 0, p?.[1] ?? p?.y ?? 0, p?.[2] ?? p?.z ?? 0)
    const target = vec3.add(pos, vec3.fromValues(0, 0, 1))
    this.cam = createFreeCamera(pos as any, target as any)
    this.cam.name = name
    attachForwardRay(this.cam)
    addToScene(scene, this.cam)
    if (setActiveOnSceneIfNoneActive) scene.camera = this.cam
  }

  get position() {
    return this.cam.position
  }

  get parent() {
    return this.cam.parent
  }

  set parent(p: any) {
    this.cam.parent = p
  }

  get minZ() {
    return this.cam.nearPlane
  }

  set minZ(v: number) {
    this.cam.nearPlane = v
  }

  get maxZ() {
    return this.cam.farPlane
  }

  set maxZ(v: number) {
    this.cam.farPlane = v
  }

  get fov() {
    return this.cam.fov
  }

  set fov(v: number) {
    this.cam.fov = v
  }

  get speed() {
    return this.cam.speed
  }

  set speed(v: number) {
    this.cam.speed = v
  }

  get inertia() {
    return this.cam.inertia
  }

  set inertia(v: number) {
    this.cam.inertia = v
  }

  get angularSensibility() {
    return this.cam.angularSensitivity
  }

  set angularSensibility(v: number) {
    this.cam.angularSensitivity = v
  }

  getScene(): SceneContext {
    return this.scene
  }

  attachControl(canvas: HTMLCanvasElement, _noPreventDefault?: boolean) {
    const cam = this.cam as any
    let offMove: (() => void) | null = null

    const mouseInput = {
      attachControl: (_noPreventDefault?: boolean) => {
        offMove?.()
        const onMove = (e: MouseEvent) => {
          if (document.pointerLockElement !== canvas) return
          const sens = this.cam.angularSensitivity || 2000
          this._rotation.y += e.movementX / sens
          this._rotation.x -= e.movementY / sens
          const maxPitch = Math.PI / 2 - 0.01
          this._rotation.x = Math.max(-maxPitch, Math.min(maxPitch, this._rotation.x))
          cam._yaw = this._rotation.y
          cam._pitch = this._rotation.x
        }
        document.addEventListener('mousemove', onMove)
        offMove = () => document.removeEventListener('mousemove', onMove)
      },
      detachControl: () => {
        offMove?.()
        offMove = null
      },
    }

    this.inputs.attached.mouse = mouseInput
    mouseInput.attachControl(_noPreventDefault)
  }

  private syncTarget() {
    const yaw = this._rotation.y
    const pitch = this._rotation.x
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)
    const cosP = Math.cos(pitch)
    const sinP = Math.sin(pitch)
    const px = this.position.x
    const py = this.position.y
    const pz = this.position.z
    this.cam.target.set(px + sinY * cosP, py + sinP, pz + cosY * cosP)
    const c = this.cam as any
    c._yaw = yaw
    c._pitch = pitch
  }

  place() {
    const bp = this.body.position as any
    const bx = bp.x ?? bp[0] ?? 0
    const by = bp.y ?? bp[1] ?? 0
    const bz = bp.z ?? bp[2] ?? 0

    if (this.distance <= 0) {
      this.cam.position.set(bx, by, bz)
      this.syncTarget()
      return
    }

    const q = quat.fromEuler(this._rotation.y, this._rotation.x, this._rotation.z, 'yxz')
    vec3.set(0, 0, -1, this.back)
    vec3.transformQuat(this.back, q, this.back)

    let dist = this.distance
    const w = physics()
    if (w && this.body.blocker) {
      const hit = w.castRay(new RAPIER.Ray(this.body.position, this.back), dist + ORBIT_MARGIN, true, undefined, undefined, undefined, this.body.blocker)
      if (hit) dist = Math.max(0, hit.timeOfImpact - ORBIT_MARGIN)
    }

    this.cam.position.set(bx + this.back[0] * dist, by + this.back[1] * dist, bz + this.back[2] * dist)
    this.syncTarget()
  }

  _decideIfNeedsToMove(): boolean {
    return false
  }

  getClassName(): string {
    return 'PlayerCamera'
  }
}
