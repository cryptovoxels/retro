import { afterEach, expect, it, vi } from 'vitest'
import { signal } from '@preact/signals'
import CostumeTool from '../src/tools/costume'

vi.mock('../src/store', () => ({ uiPane: signal(undefined) }))

let scene: BABYLON.Scene
let tool: CostumeTool

afterEach(() => {
  tool?.deactivate()
  scene?.getEngine().dispose()
})

function setup() {
  const engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
  const canvas = document.createElement('canvas')
  engine.getRenderingCanvas = () => canvas
  const camera: any = new BABYLON.FreeCamera('test', BABYLON.Vector3.Zero(), scene)
  camera.orbit = false
  camera.autoRotate = false
  const mesh = BABYLON.MeshBuilder.CreateBox('wearable', {}, scene)
  const original: any = { id: 1, name: 'test', skin: '', default_color: undefined, wallet: undefined, attachments: [{ wid: 'hat', bone: 'head', position: [0, 0, 0], rotation: [0, 0, 0], scaling: [1, 1, 1] }] }
  const manager: any = {
    costume: original,
    attachments: [],
    generateCostume: vi.fn((costume) => {
      manager.costume = costume
      manager.attachments = (costume?.attachments ?? []).map((a: any) => ({ ...a, mesh }))
    }),
  }
  const avatar: any = { avatarMesh: mesh, attachmentManager: manager, animationOverride: null }
  const controls: any = {
    camera,
    firstPersonView: true,
    targetCameraDistance: 1.5,
    movementEnabled: true,
    persona: { rotation: BABYLON.Vector3.Zero() },
    move: BABYLON.Vector3.Zero(),
    enterThirdPerson() {
      this.firstPersonView = false
    },
    enterFirstPerson() {
      this.firstPersonView = true
    },
    disableMovement() {
      this.movementEnabled = false
    },
    enableMovement() {
      this.movementEnabled = true
    },
  }
  ;(window as any).connector = { persona: { avatar }, controls }
  tool = new CostumeTool(original)
  tool.activate()
  return { original, manager, controls, mesh, avatar }
}

it('edits the existing mesh without rebuilding or mutating the saved outfit', () => {
  const { original, manager, mesh } = setup()
  tool.selected.value = 0
  tool.update({ ...tool.draft.attachments![0], position: [1, 2, 3] })
  expect(mesh.position.asArray()).toEqual([1, 2, 3])
  expect(original.attachments[0].position).toEqual([0, 0, 0])
  expect(manager.generateCostume).toHaveBeenCalledTimes(1)
})

it('restores costume, camera and movement when editing is cancelled', () => {
  const { original, manager, controls, avatar } = setup()
  expect(controls.firstPersonView).toBe(false)
  expect(controls.movementEnabled).toBe(false)
  tool.deactivate()
  expect(manager.costume).toBe(original)
  expect(controls.firstPersonView).toBe(true)
  expect(controls.movementEnabled).toBe(true)
  expect(controls.camera.orbit).toBe(false)
  expect(avatar.animationOverride).toBe(null)
  expect(controls.orbitControl).toBe(null)
})

it('converts a gizmo move back into bone-local coordinates', () => {
  const { mesh } = setup()
  const body = new BABYLON.Mesh('avatar', scene)
  body.position.set(12, 2, -8)
  const skeleton = new BABYLON.Skeleton('rig', 'rig', scene)
  const bone = new BABYLON.Bone('head', skeleton, null, BABYLON.Matrix.Translation(0, 1, 0))
  skeleton.computeAbsoluteMatrices()
  mesh.attachToBone(bone, body)
  mesh.setPreTransformMatrix(BABYLON.Matrix.Scaling(0.02, 0.02, 0.02))
  mesh.position.set(0, 0.1, 0)
  mesh.scaling.setAll(0.5)
  tool.selected.value = 0
  scene.onAfterAnimationsObservable.notifyObservers(scene)
  const before = mesh.computeWorldMatrix(true).getTranslation().clone()
  const proxy = (tool as any).proxy as BABYLON.Mesh
  proxy.position.y += 0.25
  ;(tool as any).applyProxy()
  const after = mesh.computeWorldMatrix(true).getTranslation()
  expect(mesh.parent).toBe(bone)
  expect(after.x).toBeCloseTo(before.x)
  expect(after.z).toBeCloseTo(before.z)
  expect(after.y).toBeCloseTo(before.y + 0.25)
  expect(Math.abs(mesh.position.x)).toBeLessThan(0.001)
  expect(Math.abs(mesh.position.z)).toBeLessThan(0.001)
})
