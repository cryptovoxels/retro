import Portal from '../../features/portal'
import { Mesh, SceneContext, TransformNode } from '@babylonjs/lite'

export default class PortalTeleportGUI {
  scene: SceneContext
  portal: Portal
  plane: Mesh = undefined!
  advancedDynamicTexture: any = undefined!
  grid: any = undefined!
  parent: TransformNode = undefined!

  constructor(scene: SceneContext, portal: Portal) {
    this.scene = scene
    this.portal = portal
  }

  get isSpaceWomp() {
    return !!this.portal.description.womp?.space_id
  }

  get parcelName() {
    const desc = this.portal.description
    return desc.womp?.parcel_name || desc.womp?.parcel_address || desc.womp?.space_name || desc.womp?.coords || 'location'
  }

  generate() {
    if (!this.portal.mesh) {
      return
    }
    // Create plane mesh — 4:1 to match ADT 512x128
    this.plane = (undefined as any /* todo(lite): BABYLON.MeshBuilder.CreatePlane(
      'portal/gui',
      {
        width: 1,
        height: 0.25,
        sideOrientation: BABYLON.Mesh.FRONTSIDE,
      },
      this.scene,
    ) */)
    this.plane.billboardMode = (undefined as any /* todo(lite): BABYLON.Mesh.BILLBOARDMODE_Y */)
    // Create parent transformNode
    this.parent = (undefined as any /* todo(lite): new BABYLON.TransformNode('feature/portal/parent', this.scene) */)
    this.parent.position.copyFrom(this.portal.mesh.getAbsolutePosition())
    this.plane.setParent(this.parent)
    const position_y = this.portal.mesh.scaling.y / 2 + 0.2

    this.plane.rotation.set(0, 0, 0)
    const s = 0.9
    this.plane.scaling.set(s, s, s)
    this.plane.position.set(0, position_y, 0)

    // GUI
    const advancedDynamicTexture = (undefined as any /* todo(lite): BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(this.plane, 512, 128) */)
    advancedDynamicTexture.hasAlpha = true
    this.advancedDynamicTexture = advancedDynamicTexture
    // Create grid for the GUI
    this.grid = (undefined as any /* todo(lite): new BABYLON.GUI.Grid() */)
    advancedDynamicTexture.addControl(this.grid)
    this.grid.addColumnDefinition(1)
    this.grid.addRowDefinition(1)

    this.redrawGUI()
  }

  // Refresh the GUI on edit of the portal.
  refresh() {
    if (this.advancedDynamicTexture) {
      this.dispose()
      this.generate()
    }
  }

  redrawGUI() {
    if (!this.grid) {
      return
    }

    this.grid.clearControls()

    this.grid.fontFamily = "'helvetica neue', sans-serif"
    this.grid.fontWeight = 'bold'
    this.grid.fontSize = '44px'

    const text = (undefined as any /* todo(lite): new BABYLON.GUI.TextBlock() */)
    text.text = this.parcelName
    text.textWrapping = 2
    text.height = '50px'
    text.color = 'white'

    this.grid.addControl(text, 0, 0)

    this.advancedDynamicTexture.update(true)
  }

  dispose() {
    if (this.advancedDynamicTexture) {
      this.plane?.dispose()
      this.parent?.dispose()
      this.grid?.dispose()
      this.advancedDynamicTexture.dispose()
      this.advancedDynamicTexture = null!
    }
  }
}
