import Grid from '../grid'
import { defaultColors } from '../../common/content/blocks'
import type Parcel from '../parcel'
import Connector from '../connector'
import Controls from '../controls/controls'
import { User } from '../user'
import { AudioEngine } from '../audio/audio-engine'
import type { Tool } from '../user-interface'
import { signal } from '@preact/signals'
import VertexShader from '../shaders/ao-mesh.vsh'
import FragmentShader from '../shaders/ao-mesh.fsh'
import { createGlassMaterial } from '../materials/glass'
import { hasPointerLock } from '../../common/helpers/ui-helpers'
import { track } from '../../web/src/helpers/umami'

/*
 * Fixme - this needs some refactoring around selection mode and selection
 */

export enum SelectionMode {
  Paint,
  Remove,
  Add,
}

interface VoxelPickingInfo {
  position: BABYLON.Vector3
  parcel: Parcel
}

interface Selection {
  start?: BABYLON.Vector3
  end?: BABYLON.Vector3
  parcel?: Parcel
  mode: SelectionMode
  fixedMode?: boolean
  model?: any
  textureIndex?: number
  tint?: number
  count?: number
}

let lastBlockEdit = 0 // leading-edge throttle: fire once, then ignore for 60s

export type SelectionModeOptions = {
  start?: BABYLON.Vector3
  end?: BABYLON.Vector3
  parcel?: Parcel
  fixedMode?: boolean
  model?: any
  texture?: number
  tint?: number
  count?: number
}

export default class Selector implements Tool {
  scene: BABYLON.Scene
  parent: BABYLON.TransformNode
  box: BABYLON.Mesh
  grid: Grid
  selection: Selection
  enabled = signal(false)
  connector: Connector
  controls: Controls
  user: User
  mousedown = false
  pointerPredicateCache: {
    pointerUp: (mesh: BABYLON.AbstractMesh) => boolean
    pointerDown: (mesh: BABYLON.AbstractMesh) => boolean
  } | null = null

  clickAction: any
  atlasTexture: BABYLON.Texture
  glassTexture: BABYLON.Texture
  voxelMaterial: BABYLON.ShaderMaterial
  glassMaterial: BABYLON.Material

  lastOnMovePickResult: BABYLON.PickingInfo | undefined = undefined
  private lastParcel: Parcel | undefined = undefined

  onBuildToolActivate: BABYLON.Observable<void> = new BABYLON.Observable()
  onVoxelAction: BABYLON.Observable<{ mode: SelectionMode }> = new BABYLON.Observable()
  onCurrentTextureTintUpdate: BABYLON.Observable<{ texture: number; tint: number }> = new BABYLON.Observable<{ texture: number; tint: number }>()

  constructor(scene: BABYLON.Scene, parent: BABYLON.TransformNode, grid: Grid, controls: Controls, connector: Connector) {
    this.scene = scene
    this.grid = grid
    this.controls = controls
    this.connector = connector
    this.user = controls.user
    this.parent = parent

    // Selection box
    this.box = BABYLON.MeshBuilder.CreateBox('tools/voxel/selector', { size: 0.51 }, scene)
    this.box.parent = this.parent
    this.box.isPickable = false

    // Add custom vertex attributes for voxel shader compatibility
    // CreateBox produces 24 vertices (4 per face × 6 faces)
    const vertexCount = this.box.getTotalVertices()
    const blockData = new Float32Array(vertexCount).fill(0)
    const aoData = new Float32Array(vertexCount).fill(255)
    this.box.setVerticesData('block', blockData, true, 1)
    this.box.setVerticesData('ambientOcclusion', aoData, false, 1)

    // Load the atlas texture
    this.atlasTexture = new BABYLON.Texture('/textures/atlas-ao.png', scene)
    // Load glass texture (kept for potential future use)
    this.glassTexture = new BABYLON.Texture('/images/glass.png', scene)

    // Create ShaderMaterial using the same voxel shader for consistent UV handling
    const material = new BABYLON.ShaderMaterial(
      'tools/voxel/selector',
      scene,
      { vertexSource: VertexShader, fragmentSource: FragmentShader },
      {
        attributes: ['position', 'normal', 'block', 'ambientOcclusion'],
        uniforms: ['worldViewProjection', 'tileSize', 'tileCount', 'brightness', 'ambient', 'lightDirection', 'fogDensity', 'fogColor', 'palette', 'alpha'],
        samplers: ['tileMap'],
        defines: ['#define IMAGEPROCESSINGPOSTPROCESS'],
      },
    )

    material.setTexture('tileMap', this.atlasTexture)
    material.setFloat('tileSize', 128)
    material.setFloat('tileCount', 4.0)
    material.setFloat('alpha', 0.85)
    material.alphaMode = BABYLON.Engine.ALPHA_COMBINE
    material.needAlphaBlending = () => true
    material.setColor3Array(
      'palette',
      defaultColors.map((c) => BABYLON.Color3.FromHexString(c)),
    )
    window.environment?.setShaderParameters(material, 1.5)

    // Block dirty mechanism to prevent unnecessary shader recompilation
    material.blockDirtyMechanism = true

    this.voxelMaterial = material
    this.glassMaterial = createGlassMaterial(scene as any, { name: 'ghost-block' })
    this.box.material = material

    // No default block
    this.selection = {
      mode: SelectionMode.Add,
      textureIndex: 0,
      tint: 0,
    }

    // Bind to the object so that this can be passed directly to Bablyon observable
    this.onPointerObservable = this.onPointerObservable.bind(this)
  }

  get audio(): AudioEngine | undefined {
    return window._audio
  }

  get texture() {
    return this.selection?.textureIndex || 0
  }

  set texture(value: number) {
    this.selection.textureIndex = value
    this.setTextureOffset(value)
    this.onCurrentTextureTintUpdate.notifyObservers({ texture: this.texture, tint: this.tint })
  }

  private setTextureOffset(value: number) {
    const tint = this.selection.tint ?? 0
    // Tool slot 0 -> atlas 1; block value encodes: textureIndex + (tintIndex * 32)
    const blockValue = value + 1 + tint * 32

    const vertexCount = this.box.getTotalVertices()
    const blockData = new Float32Array(vertexCount).fill(blockValue)
    this.box.updateVerticesData('block', blockData)

    // Glass (texture index 1) uses a special transparent material for accurate preview
    if (value === 1) {
      const palette = this.selection.parcel?.palette || defaultColors
      const hex = palette[tint] || defaultColors[0]
      this.box.material = createGlassMaterial(this.scene as any, { tint: hex, name: 'ghost-block' })
      return
    }

    this.box.material = this.voxelMaterial
  }

  get tint() {
    return this.selection?.tint ?? 0
  }

  set tint(value: number) {
    this.selection.tint = value
    this.updatePaletteColor()
    this.onCurrentTextureTintUpdate.notifyObservers({ texture: this.texture, tint: this.tint })
  }

  // same low-byte encoding as setTextureOffset ghost; opaque bit for solids
  get blockId() {
    const tex = this.selection.textureIndex ?? 0
    const tint = this.selection.tint ?? 0
    const low = tex + 1 + tint * 32
    return tex === 1 ? low : (1 << 15) | low
  }

  private async updateMaterialForParcel(parcel: Parcel): Promise<void> {
    const texture = parcel.tilesetTexture || Grid.mesher.defaultTileset
    this.voxelMaterial.setTexture('tileMap', texture)
    this.atlasTexture = texture
    this.updatePaletteColor()
  }

  private updatePaletteColor(): void {
    const parcel = this.selection.parcel
    const palette = parcel?.paletteColors || defaultColors.map((c) => BABYLON.Color3.FromHexString(c))
    this.voxelMaterial.setColor3Array('palette', palette)
    this.setTextureOffset(this.texture)
  }

  get ui() {
    return window.ui
  }

  setMode(mode: SelectionMode, selection?: SelectionModeOptions) {
    this.selection.mode = mode
    // Object.assign doesn't call setters; texture/tint live on the class.
    if (selection) {
      Object.entries(selection).forEach(([key, value]) => {
        if (key === 'texture' || key === 'tint') {
          ;(this as any)[key] = value
        } else {
          Object.assign(this.selection, { [key]: value })
        }
      })
    }
    this.selection.fixedMode = selection?.fixedMode || false

    this.audio?.playSound('build.select')

    // Refresh cursor
    this.onMove()

    // Update texture offset
    this.setTextureOffset(this.texture)
  }

  activate() {
    this.pointerPredicateCache = {
      pointerUp: this.scene.pointerUpPredicate,
      pointerDown: this.scene.pointerDownPredicate,
    }
    // Predicate defines which objects are included in the picklist
    this.scene.pointerMovePredicate = this.scene.pointerUpPredicate = this.scene.pointerDownPredicate = this.predicate.bind(this)

    this.selection.start = undefined
    this.selection.end = undefined

    this.enabled.value = true

    this.scene.onPointerObservable.add(this.onPointerObservable)
    document.addEventListener('pointerlockchange', this.lockListener)
    this.lockListener()

    if (this.selection.mode == SelectionMode.Add) {
      // notify that build tool just got activated
      this.onBuildToolActivate.notifyObservers()
    }

    // Update palette color on activation
    this.updatePaletteColor()
  }

  predicate(mesh: BABYLON.AbstractMesh): boolean {
    if (!(mesh.name && mesh.isVisible && mesh.isPickable)) return false
    return mesh.name.startsWith('voxel-field/collider') || mesh.name.startsWith('voxelizer/')
  }

  deactivate() {
    // reset predicates to defaults
    if (this.pointerPredicateCache) {
      this.scene.pointerUpPredicate = this.pointerPredicateCache.pointerUp
      this.scene.pointerDownPredicate = this.pointerPredicateCache.pointerDown
      this.pointerPredicateCache = null
    }
    this.scene.pointerMovePredicate = this.controls.defaultPointerMovePredicate

    this.enabled.value = false
    this.mousedown = false
    this.box.visibility = 0
    this.box.scaling.set(1, 1, 1)
    document.removeEventListener('pointerlockchange', this.lockListener)
    this.scene.onPointerObservable.removeCallback(this.onPointerObservable)
  }

  async placeBlocks(parcel: Parcel, a: BABYLON.Vector3, b: BABYLON.Vector3, block: number) {
    const now = Date.now()
    if (now - lastBlockEdit >= 60_000) {
      lastBlockEdit = now
      track('block_edit')
    }

    const bounds = this.getBounds(a, b)
    const { minimum, maximum } = bounds

    const voxelsPatch: [x: number, y: number, z: number][] = []
    for (let x = minimum.x; x <= maximum.x; x++) {
      for (let y = minimum.y; y <= maximum.y; y++) {
        for (let z = minimum.z; z <= maximum.z; z++) {
          voxelsPatch.push([Math.round(x - 1), Math.round(y - 2), Math.round(z - 1)])
        }
      }
    }
    parcel.set(voxelsPatch, block)
  }

  onPointerObservable(eventData: BABYLON.PointerInfo) {
    const pickInfo = this.controls.pickForPointer(eventData.pickInfo)
    if (!pickInfo) return
    switch (eventData.type) {
      case BABYLON.PointerEventTypes.POINTERDOWN:
        // Left-click only
        if (eventData.event.button === 0) {
          this.onLeftPointerDown(eventData.event, pickInfo)
        }
        break

      case BABYLON.PointerEventTypes.POINTERUP:
        // console.log('pointerup!?', eventData.event)
        // Left-click only
        if (eventData.event.button === 0) {
          this.onLeftPointerUp(eventData.event, pickInfo)
        }
        break

      case BABYLON.PointerEventTypes.POINTERMOVE:
        this.onMove(pickInfo)
        break
    }
  }

  private lockListener = () => {
    if (!hasPointerLock()) {
      // Escaped out of the reticule: drop the ghost now instead of waiting for a mouse move.
      if (this.controls.firstPersonView) this.box.visibility = 0

      // Set default tool
      window.ui?.setTool(window.ui?.defaultTool)

      return
    }

    const pick = this.controls.pickForPointer(null)
    if (pick) this.onMove(pick)
  }

  async onLeftPointerDown(e: BABYLON.IMouseEvent, pickResult: BABYLON.PickingInfo) {
    this.audio?.playSound('build.extend')

    this.selection.start = undefined
    this.selection.end = undefined
    this.selection.count = 1
    this.applyPointerMode(e)
    this.onMove(pickResult)

    this.mousedown = true
  }

  async onLeftPointerUp(e: BABYLON.IMouseEvent, pickResult: BABYLON.PickingInfo) {
    if (this.selection.start && this.selection.parcel) {
      let block: number

      if (this.selection.mode === SelectionMode.Remove) {
        block = 0
      } else {
        block = this.blockId
      }

      if (!this.selection.end) {
        this.selection.end = this.selection.start
      }

      this.placeBlocks(this.selection.parcel, this.selection.start, this.selection.end, block)
      this.onVoxelAction.notifyObservers({ mode: this.selection.mode })
      this.audio?.playSound('build.place')
      this.onMove(pickResult)
    }

    this.mousedown = false
  }

  checkValidBlockSelection() {
    if (!this.selection.start || !this.selection.end) return false
    return this.selection.start.y === this.selection.end.y || this.selection.start.x === this.selection.end.x || this.selection.start.z === this.selection.end.z
  }

  onMove(pickResult?: BABYLON.PickingInfo) {
    // Preseve last selected element so that onMove() can be re-triggered to refresh editor display
    if (pickResult === undefined) {
      pickResult = this.lastOnMovePickResult
    } else {
      this.lastOnMovePickResult = pickResult
    }
    if (!pickResult) return

    if (this.ui?.visible) {
      // Force deactivate
      this.deactivate()
      return
    }

    // First person builds through the locked reticule; once you Escape to free the cursor
    // there's no aim point, so don't leave a ghost block stuck under the mouse.
    if (this.controls.firstPersonView && !hasPointerLock()) {
      this.box.visibility = 0
      return
    }

    // Preview the mode on hover (shift = remove, ctrl = paint) so the ghost reflects what a
    // click will do. During a drag the mode is frozen to whatever you started the drag with.
    if (!this.mousedown) {
      this.applyPointerMode()
    }

    const voxelCenter = this.getVoxelCenter(pickResult, this.selection.mode)

    if (!voxelCenter) {
      this.box.visibility = 0
      return
    }

    const voxelPickInfo = this.pickVoxel(voxelCenter, pickResult?.getNormal())

    if (!voxelPickInfo) {
      this.box.visibility = 0
      return
    }

    if (this.mousedown) {
      // ensure parcels match to avoid wrap around when drawing between parcels
      if (voxelPickInfo.parcel == this.selection.parcel) {
        this.selection.end = voxelPickInfo.position.clone()
      }
    } else {
      this.selection.start = voxelPickInfo.position.clone()
      this.selection.end = undefined
      this.selection.parcel = voxelPickInfo.parcel
    }

    // Update material when parcel changes
    if (this.selection.parcel && this.selection.parcel !== this.lastParcel) {
      this.lastParcel = this.selection.parcel
      this.updateMaterialForParcel(this.selection.parcel).catch((err) => {
        console.error('Failed to update material for parcel:', err)
      })
    }

    if (!this.selection.start || !this.selection.parcel) {
      return
    }

    // Remove mode shows the target block fainter so you can see it's going to be deleted.
    this.voxelMaterial.setFloat('alpha', this.selection.mode === SelectionMode.Remove ? 0.3 : 0.85)

    const a = this.voxelToWorldSpace(this.selection.start, this.selection.parcel)
    if (a) {
      this.box.position.copyFrom(a)
      this.box.scaling.set(1, 1, 1)
      this.box.visibility = 1
    }

    if (this.checkValidBlockSelection() && this.selection.end) {
      const bounds = this.getBounds(this.selection.start, this.selection.end)
      const { minimum, maximum } = bounds
      const scale = maximum.subtract(minimum).addInPlaceFromFloats(1, 1, 1)
      const center = minimum.add(maximum).scaleInPlace(0.5)
      const world = this.voxelToWorldSpace(center, this.selection.parcel)
      if (world) {
        this.box.position.copyFrom(world)
        this.box.scaling.copyFrom(scale)
      }
      const count = scale.x * scale.y * scale.z
      if (count !== this.selection.count) {
        this.selection.count = count
        this.audio?.playSound('build.extend')
      }
    }
  }

  getBounds(a: BABYLON.Vector3, b: BABYLON.Vector3): BABYLON.BoundingBox {
    const x1 = Math.min(a.x, b.x)
    const x2 = Math.max(a.x, b.x)
    const y1 = Math.min(a.y, b.y)
    const y2 = Math.max(a.y, b.y)
    const z1 = Math.min(a.z, b.z)
    const z2 = Math.max(a.z, b.z)

    return new BABYLON.BoundingBox(new BABYLON.Vector3(x1, y1, z1), new BABYLON.Vector3(x2, y2, z2))
  }

  private applyPointerMode(e?: BABYLON.IMouseEvent) {
    if (this.selection.fixedMode) return
    const shift = e?.shiftKey ?? this.controls.shiftKey
    const ctrl = e?.ctrlKey ?? e?.metaKey ?? this.controls.ctrlKey
    if (shift) {
      this.selection.mode = SelectionMode.Remove
    } else if (ctrl) {
      this.selection.mode = SelectionMode.Paint
    } else {
      this.selection.mode = SelectionMode.Add
    }
  }

  getVoxelCenter(pickResult: BABYLON.PickingInfo, mode: SelectionMode): BABYLON.Vector3 | null {
    if (!pickResult || !pickResult.pickedPoint || !pickResult.getNormal()) {
      return null
    }

    const v = pickResult.pickedPoint.clone()
    const multiplier = mode === SelectionMode.Remove || mode === SelectionMode.Paint ? 0.25 : -0.25
    const norm = pickResult.getNormal()
    if (norm) v.subtractInPlace(norm.multiplyByFloats(multiplier, multiplier, multiplier))

    const trunc = (a: number) => Math.round(a * 2) / 2
    v.x = trunc(v.x)
    v.y = trunc(v.y)
    v.z = trunc(v.z)

    return v
  }

  // getParcel may match multiple parcels (because I suck
  // at maths, so we need to find the one whereupon this
  // is a valid voxel coordinate)
  pickVoxel(v: BABYLON.Vector3, normal: BABYLON.Nullable<BABYLON.Vector3> | undefined): VoxelPickingInfo | undefined {
    let parcel = null
    let position: BABYLON.Vector3 | null = null

    this.user.getParcels(v).forEach((p) => {
      if (!p.voxelMesh) {
        console.warn('pickVoxel: Parcel not meshed')
        return undefined
      }

      const pos = v.clone().subtractInPlace(p.voxelMesh.position).subtractInPlace(p.transform.position).multiplyByFloats(2, 2, 2)

      // pos is accurate position of the voxel which at ground level is y=2
      // However because the placeholder is at 2 we create a clone of the pos vector
      // and offset its y by -2 so that it makes more sense code wise
      const tmp_position = pos.clone()
      tmp_position.y -= 2

      // Standard procedure, if pick is above ground, allow edit.
      const isPickAboveGround = tmp_position.y > 0 && tmp_position.x > 0 && tmp_position.z > 0
      // This is to allow the parcel builder to edit the bottom floor if the Unit is mergeable.
      const isMergeableFloorEdit = p.isMergeableUnit()
      // However, if there is a hole between the parcels, AND we're trying to add a cube to hide the hole, allow it
      // This is to make sure that a user is able to close the hole between parcels if he doesn't own the bottom/top one
      // This case arise if a user has both parcels and sells one of them; you end up with 2 merged parcels with different owners.
      // CONS: once a block is placed we can't edit it.
      const floorIsCloseable = this.selection.mode === SelectionMode.Add && normal && (!!Math.abs(normal.z) || !!Math.abs(normal.x))
      if (isPickAboveGround || isMergeableFloorEdit || floorIsCloseable) {
        parcel = p
        position = pos
      }
    })

    if (!parcel || !position) {
      return undefined
    }

    return { position, parcel }
  }

  voxelToWorldSpace(position: BABYLON.Vector3, parcel: Parcel): BABYLON.Vector3 | undefined {
    if (!parcel.voxelMesh) {
      console.warn('voxelToWorldSpace: Parcel not meshed')
      return undefined
    }

    // offset due to voxelMesh.position.y = -1
    //result.y += 1
    return position.clone().multiplyByFloats(0.5, 0.5, 0.5).addInPlace(parcel.voxelMesh.position).addInPlace(parcel.transform.position)
  }
}
