import { beforeEach, expect, test, vi } from 'vitest'
import Persona from '../src/persona'
import { setCameraPosition } from '../src/utils/camera'

vi.mock('../src/user', () => ({}))
vi.mock('../src/controls/controls', () => ({ default: class {} }))
vi.mock('../src/connector', () => ({ default: class {} }))
vi.mock('../src/avatar', () => ({ default: class {}, LoadUserAvatar: vi.fn() }))
vi.mock('../src/voice-chat', () => ({ default: class {} }))
vi.mock('../web/src/state', () => ({ app: {}, AppEvent: {} }))
vi.mock('../web/src/helpers/umami', () => ({ track: vi.fn() }))
vi.mock('../src/utils/camera', () => ({ setCameraPosition: vi.fn(), cameraRotation: () => ({ y: 0 }), setCameraRotation: vi.fn() }))

let persona: Persona
const coords = { position: new BABYLON.Vector3(10, 2.5, 20) }

beforeEach(() => {
  persona = Object.create(Persona.prototype)
  Object.assign(persona, { scene: {}, rotation: BABYLON.Vector3.Zero(), connector: { refreshNearestParcels: vi.fn() }, controls: { resetFloor: vi.fn() } })
  window.graphic = { postProcesses: { transition: vi.fn() } } as any
  vi.mocked(setCameraPosition).mockClear()
})

test('spawn placement does not animate', () => {
  persona.moveTo(coords)
  expect(window.graphic.postProcesses!.transition).not.toHaveBeenCalled()
  expect(setCameraPosition).toHaveBeenCalledWith(expect.anything(), coords.position)
  expect(persona.controls.resetFloor).toHaveBeenCalledTimes(1)
})

test('explicit teleport schedules one animation and moves at its midpoint', () => {
  persona.teleport(coords, false)
  expect(window.graphic.postProcesses!.transition).toHaveBeenCalledTimes(1)
  expect(setCameraPosition).not.toHaveBeenCalled()
  vi.mocked(window.graphic.postProcesses!.transition).mock.calls[0][0]()
  expect(setCameraPosition).toHaveBeenCalledTimes(1)
})
