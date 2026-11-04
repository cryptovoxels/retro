import type Controls from './controls'

export default class Orbit {
  private restore: () => void
  private pointer: number | null = null
  private x = 0
  private y = 0

  constructor(
    private controls: Controls,
    private blocked: () => boolean,
  ) {
    const camera = controls.camera
    const canvas = camera.getScene().getEngine().getRenderingCanvas()!
    const first = controls.firstPersonView
    const distance = controls.targetCameraDistance
    const rotation = camera.rotation.clone()
    const orbit = camera.orbit
    const auto = camera.autoRotate
    const height = camera.orbitHeight
    const movement = controls.movementEnabled
    controls.orbitControl = this
    document.exitPointerLock?.()
    if (first) controls.enterThirdPerson(3)
    else controls.targetCameraDistance = controls.cameraDistance
    controls.disableMovement()
    controls.walkRunAnimation?.stop()
    controls.move.setAll(0)
    camera.orbit = true
    camera.autoRotate = false
    if (first) {
      camera.orbitHeight = -0.7
      camera.rotation.set(0.1, controls.persona.rotation.y + Math.PI, 0)
    }
    camera.cameraRotation.set(0, 0)
    camera.inputs.attached['mouse']?.detachControl()
    ;(controls as any).onPointerLockChange?.()
    canvas.addEventListener('pointerdown', this.down)
    canvas.addEventListener('pointermove', this.move)
    canvas.addEventListener('pointerup', this.up)
    canvas.addEventListener('pointercancel', this.up)
    canvas.addEventListener('wheel', this.wheel, { passive: false })
    this.restore = () => {
      canvas.removeEventListener('pointerdown', this.down)
      canvas.removeEventListener('pointermove', this.move)
      canvas.removeEventListener('pointerup', this.up)
      canvas.removeEventListener('pointercancel', this.up)
      canvas.removeEventListener('wheel', this.wheel)
      if (this.pointer !== null && canvas.hasPointerCapture(this.pointer)) canvas.releasePointerCapture(this.pointer)
      controls.orbitControl = null
      if (first) controls.enterFirstPerson()
      controls.targetCameraDistance = distance
      camera.rotation.copyFrom(rotation)
      camera.cameraRotation.set(0, 0)
      camera.orbit = orbit
      camera.autoRotate = auto
      camera.orbitHeight = height
      if (movement) controls.enableMovement()
      ;(controls as any).onPointerLockChange?.()
    }
  }

  private down = (e: PointerEvent) => {
    if (e.button !== 0 || this.blocked()) return
    this.pointer = e.pointerId
    this.x = e.clientX
    this.y = e.clientY
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
  }

  private move = (e: PointerEvent) => {
    if (this.pointer !== e.pointerId || this.blocked()) return
    const camera = this.controls.camera
    camera.rotation.y += (e.clientX - this.x) * 0.005
    camera.rotation.x = Math.max(-1.2, Math.min(1.2, camera.rotation.x + (e.clientY - this.y) * 0.005))
    this.x = e.clientX
    this.y = e.clientY
  }

  private up = () => {
    this.pointer = null
  }
  private wheel = (e: WheelEvent) => {
    e.preventDefault()
    this.controls.targetCameraDistance = Math.max(1, Math.min(6, this.controls.targetCameraDistance + e.deltaY * 0.003))
  }

  dispose() {
    this.restore()
  }
}
