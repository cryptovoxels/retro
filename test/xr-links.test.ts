import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import openLink from '../src/ui/open-link'
import { isFastviewBlocking, openDialog } from '../common/helpers/ui-helpers'

vi.mock('../src/utils/helpers', () => ({ isURL: (url: string) => URL.canParse(url) }))
vi.mock('../common/helpers/detector', () => ({ isMobileMedia: () => false }))

let scene: any
let opened: ReturnType<typeof vi.fn>
let frames: BABYLON.Observable<BABYLON.Scene>
let camera: { position: { x: number; y: number; z: number } }

beforeEach(() => {
  vi.useFakeTimers()
  scene = { activeCamera: Object.create(BABYLON.WebXRCamera.prototype) }
  frames = new BABYLON.Observable()
  camera = { position: { x: 0, y: 1.65, z: 0 } }
  vi.stubGlobal('scene', scene)
  vi.stubGlobal('connector', { controls: { camera }, scene: { onBeforeRenderObservable: frames } })
  vi.stubGlobal('engine', { setBlur: vi.fn() })
  opened = vi.fn()
  window.addEventListener('dialogopen', opened)
})

afterEach(() => {
  document.querySelectorAll('dialog').forEach((el: any) => el.dismiss?.())
  vi.runOnlyPendingTimers()
  document.body.replaceChildren()
  window.removeEventListener('dialogopen', opened)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('ordinary world dialogs request the shared XR exit and stay open', () => {
  const { el } = openDialog('audio-properties')
  expect(opened).toHaveBeenCalledTimes(1)
  expect(el.isConnected).toBe(true)
  expect(el.classList.contains('pointer-lock-close')).toBe(true)
  expect(el.classList.contains('fastview')).toBe(false)
})

test.each(['nft-view', 'womp-view'])('XR %s dialogs disable desktop fastview dismissal', (name) => {
  opened.mockImplementation(() => (scene.activeCamera = {}))
  const { el } = openDialog(name, true)
  expect(opened).toHaveBeenCalledTimes(1)
  expect(el.classList.contains('fastview')).toBe(false)
  expect(isFastviewBlocking()).toBe(false)
  expect(frames.observers).toHaveLength(0)
  camera.position.x = 2
  frames.notifyObservers(scene)
  vi.runOnlyPendingTimers()
  expect(el.isConnected).toBe(true)
})

test('external links use the shared dialog exit and retain their confirmation', () => {
  openLink('https://example.com/gallery')
  expect(opened).toHaveBeenCalledTimes(1)
  expect(document.querySelector('a')?.href).toBe('https://example.com/gallery')
  expect(document.querySelector('button.close')).not.toBeNull()
})

test('desktop fastview keeps its walk-to-dismiss behavior', () => {
  scene.activeCamera = {}
  const { el } = openDialog('womp-view', true)
  expect(el.classList.contains('fastview')).toBe(true)
  expect(isFastviewBlocking()).toBe(true)
  camera.position.x = 2
  frames.notifyObservers(scene)
  expect(el.isConnected).toBe(false)
  expect(isFastviewBlocking()).toBe(false)
})

test('desktop links retain the existing confirmation', () => {
  scene.activeCamera = {}
  openLink('https://example.com/gallery')
  expect(document.querySelector('a')?.href).toBe('https://example.com/gallery')
  expect(document.querySelector('dialog.fastview')).toBeNull()
})

test('ordinary web pages can open dialogs without Babylon or a game scene', () => {
  vi.stubGlobal('BABYLON', undefined)
  vi.stubGlobal('scene', undefined)
  const { el } = openDialog('settings')
  expect(el.isConnected).toBe(true)
})
