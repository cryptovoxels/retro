import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Bubble } from '../src/chat'
import Avatar from '../src/avatar'
import { matcher } from '../src/obscenity'
import { isHate } from '../src/hate'
import { chatLines, chatStyle, standing } from '../src/utils'
import { Animations } from '../src/avatar-animations'

vi.mock('../web/src/state', () => ({ app: {} }))
vi.mock('../src/attachment-manager', () => ({ AvatarAttachmentManager: class {} }))
vi.mock('../src/audio/fly-sound', () => ({ RemoteFlySound: class {} }))
vi.mock('../src/utils/emote', () => ({ emote: () => {} }))
vi.mock('../src/utils/helpers', () => ({ resolveUgc: (s: string) => s }))

vi.mock('../src/hate', () => ({ isHate: vi.fn(() => false) }))
vi.mock('../src/obscenity', () => ({ matcher: { getAllMatches: vi.fn(() => []) } }))

let engine: BABYLON.NullEngine
let scene: BABYLON.Scene
let parent: BABYLON.TransformNode
let now = 0
const context: any = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  roundRect: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  fillText: vi.fn(),
  fillRect: vi.fn(),
  createRadialGradient: () => ({ addColorStop: () => {} }),
  measureText: (text: string) => ({ width: text.length * 10 }),
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  now = 0
  engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
  parent = new BABYLON.TransformNode('avatar', scene)
  document.body.style.fontFamily = 'Arial, sans-serif'
  document.body.style.setProperty('--bg', '#2e2c2f')
  document.body.style.setProperty('--fg', '#d6d4d7')
})

afterEach(() => {
  scene.dispose()
  engine.dispose()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function frame(time: number) {
  now = time
  parent.computeWorldMatrix(true)
  scene.onBeforeRenderObservable.notifyObservers(scene)
}

test('bubble follows its avatar, holds for 19.5s, then fades and expires even offscreen', () => {
  const bubble = new Bubble(scene, parent, 'hello')
  const material = bubble.material!
  parent.position.set(4, 5, 6)
  bubble.isVisible = false
  frame(19500)
  expect(bubble.position.asArray()).toEqual([4, 5.75, 6])
  expect(material.alpha).toBe(1)
  frame(19750)
  expect(material.alpha).toBe(0.5)
  frame(20000)
  expect(bubble.isDisposed()).toBe(true)
  expect(scene.materials).not.toContain(material)
  expect(scene.onBeforeRenderObservable.hasObservers()).toBe(false)
  expect(context.clearRect).toHaveBeenCalledTimes(1)
})

test('disposing a replaced bubble releases its texture and timer without affecting the new bubble', () => {
  const first = new Bubble(scene, parent, 'first')
  const texture = (first.material as BABYLON.StandardMaterial).diffuseTexture
  frame(10000)
  first.dispose()
  const second = new Bubble(scene, parent, 'second')
  expect(scene.textures).not.toContain(texture)
  frame(20000)
  expect(second.isDisposed()).toBe(false)
  expect(second.material!.alpha).toBe(1)
  frame(30000)
  expect(second.isDisposed()).toBe(true)
  expect(scene.onBeforeRenderObservable.hasObservers()).toBe(false)
})

test('avatar disposal expires its bubble', () => {
  const bubble = new Bubble(scene, parent, 'hello')
  parent.dispose()
  frame(1)
  expect(bubble.isDisposed()).toBe(true)
})

test('chat styles come from CSS and long text wraps into at most three bounded lines', () => {
  expect(chatStyle()).toMatchObject({ font: 'Arial, sans-serif', background: '#2e2c2f', color: '#d6d4d7' })
  const lines = chatLines(context, 'long message '.repeat(40))
  expect(lines).toHaveLength(3)
  expect(lines[2].endsWith('...')).toBe(true)
  for (const line of lines) expect(context.measureText(line).width).toBeLessThanOrEqual(464)
  for (const line of chatLines(context, 'x'.repeat(200))) expect(context.measureText(line).width).toBeLessThanOrEqual(464)
})

test('only idle, walking and running allow a shadow', () => {
  for (const state of Object.values(Animations).filter((v) => typeof v === 'number')) {
    expect(standing(state)).toBe([Animations.Idle, Animations.Walk, Animations.Run].includes(state))
  }
})

function testAvatar() {
  const avatar: any = Object.create(Avatar.prototype)
  avatar.scene = scene
  avatar.node = parent
  avatar.armatureMesh = { visibility: 1 }
  avatar.animation = { state: Animations.Idle }
  parent.setEnabled(true)
  return avatar
}

test('new avatar chat immediately replaces the previous bubble', () => {
  const avatar = testAvatar()
  avatar.addChat('first')
  const first = avatar._bubble
  frame(10000)
  avatar.addChat('second')
  expect(first.isDisposed()).toBe(true)
  expect(avatar._bubble.text).toBe('second')
  frame(20000)
  expect(avatar._bubble.isDisposed()).toBe(false)
})

test('shadow follows feet, hides for vehicles and hidden avatars, shares resources and cleans up', () => {
  const avatar = testAvatar()
  avatar.addShadow()
  const mesh = avatar.shadowMesh
  const other = testAvatar()
  other.addShadow()
  expect(other.shadowMesh.material).toBe(mesh.material)
  parent.position.set(2, 3, 4)
  frame(1)
  expect(mesh.position.x).toBe(2)
  expect(mesh.position.y).toBeCloseTo(1.415)
  expect(mesh.isEnabled()).toBe(true)
  avatar.animation.state = Animations.Floating
  frame(2)
  expect(mesh.isEnabled()).toBe(false)
  avatar.animation.state = Animations.Run
  avatar._vehicle = {}
  frame(3)
  expect(mesh.isEnabled()).toBe(false)
  avatar._vehicle = null
  avatar.armatureMesh.visibility = 0
  frame(4)
  expect(mesh.isEnabled()).toBe(false)
  const shared = mesh.material
  mesh.dispose()
  expect(scene.materials).toContain(shared)
  other.shadowMesh.dispose()
  expect(scene.onBeforeRenderObservable.hasObservers()).toBe(false)
  scene.dispose()
  expect(scene.materials).not.toContain(shared)
})

test('wrapped messages keep moderation blur and render emoji as whole code points', () => {
  const painted: { text: string; filter: string }[] = []
  context.fillText.mockImplementation((text: string) => painted.push({ text, filter: context.filter }))
  vi.mocked(matcher.getAllMatches).mockReturnValue([{ startIndex: 45, endIndex: 51 }] as any)
  new Bubble(scene, parent, 'x'.repeat(44) + ' badword')
  expect(
    painted
      .filter((p) => p.filter === 'blur(3px)')
      .map((p) => p.text)
      .join(''),
  ).toBe('badword')
  vi.mocked(matcher.getAllMatches).mockReturnValue([])
  painted.length = 0
  new Bubble(scene, parent, '\u{1F44B}')
  expect(painted.map((p) => p.text)).toEqual(['\u{1F44B}'])
  vi.mocked(isHate).mockReturnValue(true)
  painted.length = 0
  new Bubble(scene, parent, 'whole message')
  expect(painted.every((p) => p.filter === 'blur(3px)')).toBe(true)
})
