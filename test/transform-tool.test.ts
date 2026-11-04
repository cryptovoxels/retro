import { afterEach, expect, it, vi } from 'vitest'
import { bindGizmosToFeature, createGizmos, unbindGizmosFromFeature } from '../src/tools/gizmos'

vi.mock('../src/store', () => ({ setSelectedFeature: vi.fn() }))
vi.mock('../src/utils', () => ({ freezeFeature: vi.fn(), thawFeature: vi.fn() }))

let scene: BABYLON.Scene
let canvas: HTMLCanvasElement
let feature: any

afterEach(() => {
  if (feature) unbindGizmosFromFeature(feature)
  scene?.dispose()
  scene?.getEngine().dispose()
  document.body.replaceChildren()
})

function setup() {
  const engine = new BABYLON.NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 })
  scene = new BABYLON.Scene(engine)
  canvas = document.createElement('canvas')
  document.body.append(canvas)
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }) as DOMRect
  canvas.setPointerCapture = vi.fn()
  canvas.hasPointerCapture = () => true
  canvas.releasePointerCapture = vi.fn()
  engine.getRenderingCanvas = () => canvas
  const camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -10), scene)
  camera.setTarget(BABYLON.Vector3.Zero())
  const parent = new BABYLON.TransformNode('parcel', scene)
  parent.rotation.y = 0.3
  parent.scaling.set(1.4, 1.2, 1)
  const mesh = BABYLON.MeshBuilder.CreatePlane('picture', {}, scene)
  mesh.parent = parent
  mesh.scaling.set(2.01, 1.01, 1)
  mesh.position.z = -0.01
  feature = {
    type: 'image',
    uuid: 'picture',
    mesh,
    position: BABYLON.Vector3.Zero(),
    scale: new BABYLON.Vector3(2, 1, 0),
    set: vi.fn((props: any) => {
      feature.position.fromArray(props.position)
      feature.scale.fromArray(props.scale)
      mesh.position.copyFrom(feature.position)
      mesh.position.z -= 0.01
      mesh.scaling.set(feature.scale.x + 0.01, feature.scale.y + 0.01, 1)
    }),
    dispatchEvent: vi.fn(),
  }
  ;(window as any).ui = { setDragging: vi.fn(), featureTool: { updateHighlight: vi.fn() } }
  createGizmos(scene)
  bindGizmosToFeature(feature)
  scene.render()
  scene.render()
  return mesh
}

function pointer(target: EventTarget, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, altKey: true })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  target.dispatchEvent(event)
}

function corner() {
  const handle = document.querySelectorAll<HTMLButtonElement>('.transform-handle')[3]
  return { handle, x: parseFloat(handle.style.left), y: parseFloat(handle.style.top) }
}

it('resizes a rotated, scaled-parent picture around its opposite corner without a release jump', () => {
  const mesh = setup()
  const anchor = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(-0.5, -0.5, 0), mesh.computeWorldMatrix(true))
  const { handle, x, y } = corner()
  pointer(handle, 'pointerdown', x, y)
  pointer(document, 'pointermove', x + 70, y - 35)
  scene.render()
  const during = mesh.getWorldMatrix().clone()
  const after = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(-0.5, -0.5, 0), during)
  expect(BABYLON.Vector3.Distance(anchor, after)).toBeLessThan(0.0001)
  expect(document.querySelector('output')?.textContent).toMatch(/\d\.\d\d x \d\.\d\d m/)
  pointer(document, 'pointerup', x + 70, y - 35)
  expect(feature.set).toHaveBeenCalledTimes(1)
  expect(feature.scale.x / feature.scale.y).toBeCloseTo(2, 3)
  const committed = mesh.computeWorldMatrix(true)
  during.asArray().forEach((n, i) => expect(committed.asArray()[i]).toBeCloseTo(n, 3))
})

it('Escape restores both position and scale without saving or leaking drag ownership', () => {
  const mesh = setup()
  const start = mesh.computeWorldMatrix(true).clone()
  const { handle, x, y } = corner()
  pointer(handle, 'pointerdown', x, y)
  pointer(document, 'pointermove', x + 80, y - 40)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(feature.set).not.toHaveBeenCalled()
  expect(mesh.computeWorldMatrix(true).asArray()).toEqual(start.asArray())
  expect(window.ui!.setDragging).toHaveBeenLastCalledWith(false)
  expect(canvas.releasePointerCapture).toHaveBeenCalledWith(1)
})

it('a face drag stays in the picture plane and cancellation restores it', () => {
  const mesh = setup()
  const start = mesh.position.clone()
  pointer(canvas, 'pointerdown', 400, 300)
  pointer(document, 'pointermove', 450, 320)
  expect(mesh.position.x).not.toBeCloseTo(start.x)
  expect(mesh.position.z).toBeCloseTo(start.z)
  pointer(document, 'pointercancel', 450, 320)
  expect(mesh.position.asArray()).toEqual(start.asArray())
  expect(feature.set).not.toHaveBeenCalled()
})

it('removes handles and observers when selection changes during a drag', () => {
  setup()
  const { handle, x, y } = corner()
  pointer(handle, 'pointerdown', x, y)
  pointer(document, 'pointermove', x + 50, y)
  unbindGizmosFromFeature(feature)
  pointer(document, 'pointerup', x + 50, y)
  expect(feature.set).not.toHaveBeenCalled()
  expect(document.querySelector('.transform-handle')).toBeNull()
  expect(document.querySelector('.transform-size')).toBeNull()
  expect(window.ui!.setDragging).toHaveBeenLastCalledWith(false)
})

it('the shared proxy moves on world axes under a rotated parent and cancels cleanly', async () => {
  const { default: Transform } = await import('../src/tools/transform')
  const mesh = setup()
  unbindGizmosFromFeature(feature)
  const transform = new Transform(scene)
  transform.attach(mesh)
  transform.sync()
  const start = mesh.computeWorldMatrix(true).getTranslation().clone()
  const end = vi.fn()
  transform.onEnd = end
  transform.gizmos.gizmos.positionGizmo!.onDragStartObservable.notifyObservers({} as any)
  transform.proxy.position.x += 0.5
  transform.apply()
  const moved = mesh.computeWorldMatrix(true).getTranslation()
  expect(moved.x).toBeCloseTo(start.x + 0.5)
  expect(moved.y).toBeCloseTo(start.y)
  expect(moved.z).toBeCloseTo(start.z)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const restored = mesh.computeWorldMatrix(true).getTranslation()
  expect(BABYLON.Vector3.Distance(restored, start)).toBeLessThan(0.00001)
  expect(end).toHaveBeenCalledWith(false)
  expect(transform.dragging).toBe(false)
  transform.dispose()
})
