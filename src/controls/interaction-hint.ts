import { hasPointerLock, isFastviewBlocking } from '../../common/helpers/ui-helpers'
import { featureFromPick } from './controls'
import type DesktopControls from './desktop/controls'

const INTERACT_D = 2

export class InteractionHint {
  constructor(
    private controls: DesktopControls,
    private scene: BABYLON.Scene,
  ) {
    document.addEventListener('keydown', this.key, true)
  }

  private target() {
    const c = this.controls
    const locked = hasPointerLock()
    if (!(locked || this.scene.getEngine().getRenderingCanvas()?.matches(':hover')) || window.ui?.activeTool || isFastviewBlocking()) return
    const x = locked ? undefined : this.scene.pointerX,
      y = locked ? undefined : this.scene.pointerY
    const candidate = c.pickAtView(x, y, false, (m) => c.reticuleHighlightPredicate(m))
    const near = (hit: BABYLON.PickingInfo | null) => {
      const point = hit?.pickedPoint,
        body = c.body.position
      return !!point && (point.x - body.x) ** 2 + (point.y - body.y) ** 2 + (point.z - body.z) ** 2 <= INTERACT_D ** 2
    }
    if (!near(candidate) || !featureFromPick(candidate)?.interactHint) return
    // Only cast against the walls once there is a nearby action worth showing.
    const pick = c.pickAtView(x, y)
    const feature = featureFromPick(pick)
    if (pick && near(pick) && feature?.interactHint && !feature.disposed) return { feature, pick }
  }

  private key = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable=true]') || this.controls.vehicleFeature) return
    const target = this.target()
    if (!target) return
    e.preventDefault()
    e.stopImmediatePropagation()
    target.feature.onClick({ point: [], normal: [] })
  }

  dispose() {
    document.removeEventListener('keydown', this.key, true)
  }
}
