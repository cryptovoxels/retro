import { isMobile } from '../../../common/helpers/detector'
import { hasPointerLock, requestPointerLockIfNoOverlays } from '../../../common/helpers/ui-helpers'
import Feature from '../../features/feature'
import { cameraPosition } from '../../utils/camera'

type guiControlsType = 'button' | 'text'

export interface guiControls {
  uuid: string
  type: guiControlsType
  id?: string
  text?: string
  fontSizePx?: string
  height?: string | number
  positionInGrid?: [number, number]
  /* overrides the onClick if present for buttons */
  onClick?: (eventData: BABYLON.GUI.Vector2WithInfo, eventState: BABYLON.EventState) => void
}

export interface guiControlsOptions {
  positionInGrid?: [number, number]
  text?: string
  fontSizePx?: string // only on text
  height?: string | number
  onClick?: (eventData: BABYLON.GUI.Vector2WithInfo, eventState: BABYLON.EventState) => void // only on buttons
}

export type FeatureBasicGUIOptions = {
  position?: BABYLON.Vector3
  listOfControls?: guiControls[]
  billBoardMode?: number
  textureWidth?: number
  textureHeight?: number
  planeWidth?: number
  planeHeight?: number
  rowDefinition?: number
  gridFontSizePx?: string
}

export default class FeatureBasicGUI {
  scene: BABYLON.Scene
  feature: Feature
  plane: BABYLON.Mesh = null!
  advancedDynamicTexture: BABYLON.GUI.AdvancedDynamicTexture
  grid: BABYLON.GUI.Grid
  parent: BABYLON.TransformNode
  listOfControls: guiControls[] = []
  _billboardMode: number
  uuid: string
  _options?: FeatureBasicGUIOptions = { listOfControls: [], billBoardMode: BABYLON.Mesh.BILLBOARDMODE_Y }

  constructor(feature: Feature, uuid: string, options?: FeatureBasicGUIOptions) {
    this.feature = feature
    this.scene = feature.scene
    this.uuid = uuid
    this.advancedDynamicTexture = null!
    this.grid = null!
    this.parent = null!
    // Setup
    this._options = options
    this.listOfControls = options?.listOfControls || []
    this._billboardMode = options?.billBoardMode || BABYLON.Mesh.BILLBOARDMODE_Y
  }

  get textureSizeFromOptions() {
    const sizes = [512, 128]
    if (typeof this._options?.textureWidth == 'number') {
      sizes[0] = this._options?.textureWidth
    }
    if (typeof this._options?.textureHeight == 'number') {
      sizes[1] = this._options?.textureHeight
    }
    return sizes
  }

  get planeSizeFromOptions() {
    const sizes = { width: 1, height: 0.25 }
    if (typeof this._options?.planeWidth == 'number') {
      sizes.width = this._options?.planeWidth
    }
    if (typeof this._options?.planeHeight == 'number') {
      sizes.height = this._options?.planeHeight
    }

    console.log('planeSizeFromOptions', sizes)

    return sizes
  }

  get connector() {
    return window.connector
  }

  get behaviours() {
    return this.feature?.parcel.behaviours
  }

  billBoardMode() {
    if (this._billboardMode == BABYLON.Mesh.BILLBOARDMODE_Y || this._billboardMode == BABYLON.Mesh.BILLBOARDMODE_NONE) {
      return this._billboardMode
    }
    return BABYLON.Mesh.BILLBOARDMODE_Y
  }

  generate() {
    const scene = this.scene
    const featureMesh = this.feature.mesh

    if (!featureMesh) {
      return
    }
    // Create plane mesh
    this.plane = BABYLON.MeshBuilder.CreatePlane(
      `feature/basicGui/${this.feature.type}`,
      {
        ...this.planeSizeFromOptions,
        sideOrientation: BABYLON.Mesh.FRONTSIDE,
      },
      scene,
    )
    this.plane.billboardMode = this.billBoardMode()
    // Create parent transformNode
    this.parent = new BABYLON.TransformNode('feature/basicGui/parent', scene)

    this.parent.position = featureMesh.getAbsolutePosition()

    this.plane.setParent(this.parent)

    if (this.billBoardMode() == BABYLON.Mesh.BILLBOARDMODE_NONE) {
      const camPos = cameraPosition(this.scene)
      const p = this.parent.position
      const angle = Math.atan2(p.z - camPos.z, p.x - camPos.x)
      this.plane.rotation.set(0, Math.PI / 2 - angle, 0)
    } else {
      this.plane.rotation.set(0, 0, 0)
    }
    const s = 0.9
    this.plane.scaling.set(s, s, s)

    // handle positioning of the GUI
    if (!this._options?.position || !(this._options?.position instanceof BABYLON.Vector3)) {
      const position_y = featureMesh.scaling.y / 2 + 0.15 + (this.listOfControls.length * (this._options?.rowDefinition ? 0.1 + 0.05 * this._options?.rowDefinition : 0.1)) / 2 // Add an offset to make it fit nicely
      this.plane.position.set(0, position_y, 0)
    } else {
      // a position was given in the options so we use that
      this.plane.position.copyFrom(this._options?.position)
    }

    // GUI
    const advancedDynamicTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(this.plane, ...this.textureSizeFromOptions)
    advancedDynamicTexture.hasAlpha = true
    this.advancedDynamicTexture = advancedDynamicTexture

    this.generateGrid()

    this.redrawGUI()
  }

  generateGrid() {
    // Create grid for the GUI
    this.grid = new BABYLON.GUI.Grid()
    this.advancedDynamicTexture.addControl(this.grid)

    let numberOfRows = 0
    let numberOfColumns = 0
    // Code to automatically generate an optimal grid given the number of controls.
    if (this.listOfControls && this.listOfControls?.length > 0) {
      for (const control of this.listOfControls) {
        if (!control.positionInGrid) {
          continue
        }
        // columns
        if (control.positionInGrid[1] && control.positionInGrid[1] > numberOfColumns) {
          numberOfColumns = control.positionInGrid[1]
        }
        // rows
        if (control.positionInGrid[0] && control.positionInGrid[0] > numberOfRows) {
          numberOfRows = control.positionInGrid[0]
        }
      }
    }
    for (let i = 0; i < numberOfColumns + 1; i++) {
      this.grid.addColumnDefinition(1)
    }
    for (let i = 0; i < numberOfRows + 1; i++) {
      const rowSize = typeof this._options?.rowDefinition == 'number' ? this._options?.rowDefinition : 0.5
      this.grid.addRowDefinition(rowSize)
    }
  }

  // Refresh the GUI
  refresh() {
    if (this.advancedDynamicTexture) {
      this.dispose()
      this.generate()
    } else {
      this.generate()
    }
  }

  onClick = (uuid: string, id?: string) => {
    if (this.behaviours) {
      this.behaviours.dispatch(this.feature.uuid, 'click', { guiTarget: uuid, controlId: id })
    }
  }

  redrawGUI() {
    if (!this.grid) {
      return
    }

    this.grid.clearControls()

    this.grid.fontFamily = "'source code pro', monospace"
    this.grid.fontWeight = 'bold'
    this.grid.fontSize = typeof this._options?.gridFontSizePx == 'string' ? this._options?.gridFontSizePx : '22px'

    this.listOfControls.forEach((control: guiControls) => {
      this.createControl(control)
    })

    this.advancedDynamicTexture.update()
  }

  createControl(control: guiControls) {
    let controlObject
    switch (control.type) {
      case 'text':
        controlObject = this.createText(control)
        break
      case 'button':
        controlObject = this.createButton(control)
        break
    }

    if (control.positionInGrid && control.positionInGrid?.length == 2) {
      // row first, column second and starts at 0
      this.grid.addControl(controlObject, control.positionInGrid[0], control.positionInGrid[1])
    } else {
      this.grid.addControl(controlObject, 0, 0)
    }
  }

  getControlByUuid(uuid: string) {
    return this.listOfControls.find((control) => control.uuid == uuid)
  }

  dispose() {
    if (this.advancedDynamicTexture) {
      this.plane?.dispose()
      this.parent?.dispose()
      this.parent = null!
      this.grid?.dispose()
      this.grid = null!
      this.advancedDynamicTexture.dispose()
      this.advancedDynamicTexture = null!
    }
  }

  createText(control: guiControls) {
    // Make text fit
    const ctx = this.advancedDynamicTexture.getContext()
    const size = 3 //any value will work
    ctx.font = this.grid.fontSize + ' ' + this.grid.fontFamily
    const textWidth = ctx.measureText(control.text || '').width
    const ratio = textWidth / size
    const minimumFontSize = 18
    const maximumFontSize = 40

    const textBlock = new BABYLON.GUI.TextBlock()
    textBlock.text = control.text || ''

    const calculatedSize = Math.floor(this.textureSizeFromOptions[0] / ratio)
    textBlock.fontSize = control.fontSizePx ? control.fontSizePx : calculatedSize < minimumFontSize ? minimumFontSize : calculatedSize > maximumFontSize ? maximumFontSize : calculatedSize
    textBlock.height = control.height || 1

    textBlock.color = 'white'

    return textBlock
  }

  createButton(control: guiControls) {
    const text = control.text || ''

    const textBlock = this.createText(control)

    // Create button
    const button = BABYLON.GUI.Button.CreateSimpleButton(control!.id || '', text || '')
    button.width = textBlock.width
    button.height = textBlock.height
    button.fontSize = textBlock.fontSize
    button.color = '#333'
    button.isPointerBlocker = true
    button.cornerRadius = 5
    button.background = 'White'
    button.onPointerUpObservable.add((eventData, eventState) => {
      if (!this.grid.isVisible) {
        return
      }
      if (!!isMobile() || hasPointerLock()) {
        if (control.onClick) {
          control.onClick(eventData, eventState)
        } else {
          this.onClick(control.uuid, control.id)
        }
      } else {
        requestPointerLockIfNoOverlays()
      }
    })

    // Cleanup
    textBlock.dispose()
    return button
  }
}
