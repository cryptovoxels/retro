import RAPIER from '@dimforge/rapier3d-compat'
import { physics } from '../../physics/world'
import type PlayerBody from './player-body'
import { addToScene, attachFreeControl, createFreeCamera, FreeCamera, SceneContext, Vec3 } from '@babylonjs/lite'
import { attachForwardRay } from '../../utils/camera'
import { patchVec3 } from '../../utils/vec3-compat'
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
    add: (_input: any) => {},
    remove: (_input: any) => {},
    addGamepad: () => {},
  }

  constructor(name: string, position: Vec3, scene?: SceneContext, setActiveOnSceneIfNoneActive = true) {
    if (!scene) throw new Error('PlayerCamera needs a scene')
    this.scene = scene
    const p = position as any
    const pos = vec3.fromValues(p?.[0] ?? p?.x ?? 0, p?.[1] ?? p?.y ?? 0, p?.[2] ?? p?.z ?? 0)
    const target = vec3.add(pos, vec3.fromValues(0, 0, 1))
    this.cam = createFreeCamera(pos as any, target as any)
    patchVec3(this.cam.position as any)
    patchVec3(this.cam.target as any)
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
    attachFreeControl(this.cam, canvas, this.scene)
  }

  _decideIfNeedsToMove(): boolean {
    return false
  }

  place() {
    if (this.distance <= 0) {
      this.position.copyFrom(this.body.position as any)
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
    vec3.copy(this.body.position as any, this.position as any)
    vec3.scale(dist, this.back, this.back)
    vec3.add(this.position as any, this.back, this.position as any)
  }

  getClassName(): string {
    return 'PlayerCamera'
  }
}
