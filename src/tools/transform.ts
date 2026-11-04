import TransformOverlay from './transform-overlay'

// Babylon cannot decompose bone parents. Manipulate a world-space proxy, then
// remove the parent and importer pivot before writing back to the selected node.
export default class Transform {
  readonly layer: BABYLON.UtilityLayerRenderer
  readonly gizmos: BABYLON.GizmoManager
  readonly proxy: BABYLON.Mesh
  readonly overlay: TransformOverlay
  dragging = false
  onStart = () => {}
  onEnd = (_commit: boolean) => {}
  private target: BABYLON.TransformNode | null = null
  private inverse = BABYLON.Matrix.Identity()
  private local = BABYLON.Matrix.Identity()
  private scratch = BABYLON.Matrix.Identity()
  private start = BABYLON.Matrix.Identity()
  private rotation = BABYLON.Quaternion.Identity()
  private modeValue = 'position'
  private frame: BABYLON.Observer<BABYLON.Scene>

  constructor(private scene: BABYLON.Scene) {
    this.proxy = new BABYLON.Mesh('transform/proxy', scene)
    this.proxy.rotationQuaternion = BABYLON.Quaternion.Identity()
    this.overlay = new TransformOverlay(scene)
    this.layer = new BABYLON.UtilityLayerRenderer(scene)
    this.gizmos = new BABYLON.GizmoManager(scene, 1, this.layer)
    this.gizmos.usePointerToAttachGizmos = false
    this.gizmos.positionGizmoEnabled = this.gizmos.rotationGizmoEnabled = this.gizmos.scaleGizmoEnabled = true
    for (const gizmo of [this.gizmos.gizmos.positionGizmo!, this.gizmos.gizmos.rotationGizmo!, this.gizmos.gizmos.scaleGizmo!]) {
      gizmo.scaleRatio = 0.8
      gizmo.onDragStartObservable.add(() => {
        this.start.copyFrom(this.proxy.computeWorldMatrix(true))
        this.dragging = true
        this.onStart()
      })
      gizmo.onDragObservable.add(() => this.apply())
      gizmo.onDragEndObservable.add(() => this.finish(true))
    }
    this.mode('position')
    this.frame = scene.onBeforeRenderObservable.add(() => this.sync())
    document.addEventListener('keydown', this.key, true)
    document.addEventListener('pointercancel', this.cancel, true)
    window.addEventListener('blur', this.cancel)
  }

  attach(target: BABYLON.TransformNode | null) {
    if (this.target === target) return
    this.finish(false)
    this.target = target
    this.sync()
    this.gizmos.attachToMesh(target ? this.proxy : null)
  }

  sync() {
    const target = this.target
    if (target && !this.dragging) {
      const world = target.computeWorldMatrix(true)
      if (target.rotationQuaternion) this.rotation.copyFrom(target.rotationQuaternion)
      else BABYLON.Quaternion.FromEulerVectorToRef(target.rotation, this.rotation)
      BABYLON.Matrix.ComposeToRef(target.scaling, this.rotation, target.position, this.local)
      target.getPivotMatrix().multiplyToRef(this.local, this.scratch)
      this.scratch.invertToRef(this.local)
      this.local.multiplyToRef(world, this.inverse)
      this.inverse.invert()
      world.decompose(this.proxy.scaling, this.proxy.rotationQuaternion!, this.proxy.position)
    }
    this.overlay.sync(target instanceof BABYLON.AbstractMesh ? target : null, false, this.dragging && this.modeValue === 'scale' ? 7 : -1)
  }

  apply() {
    if (!this.target) return
    this.target.getPivotMatrix().invertToRef(this.scratch)
    this.proxy.computeWorldMatrix(true).multiplyToRef(this.inverse, this.local)
    this.scratch.multiplyToRef(this.local, this.local)
    this.local.decompose(this.target.scaling, this.rotation, this.target.position)
    if (this.target.rotationQuaternion) this.target.rotationQuaternion.copyFrom(this.rotation)
    else this.rotation.toEulerAnglesToRef(this.target.rotation)
  }

  mode(mode: 'position' | 'rotation' | 'scale') {
    this.finish(false)
    this.modeValue = mode
    this.gizmos.positionGizmoEnabled = mode === 'position'
    this.gizmos.rotationGizmoEnabled = mode === 'rotation'
    this.gizmos.scaleGizmoEnabled = mode === 'scale'
  }

  over() {
    return this.dragging || !!this.layer.utilityLayerScene.pick(this.scene.pointerX, this.scene.pointerY)?.hit
  }

  private finish(commit: boolean) {
    if (!this.dragging) return
    this.dragging = false
    if (!commit) {
      this.start.decompose(this.proxy.scaling, this.proxy.rotationQuaternion!, this.proxy.position)
      this.apply()
      // Detaching releases Babylon's drag behavior before another pointer move.
      this.gizmos.attachToMesh(null)
      this.gizmos.attachToMesh(this.target ? this.proxy : null)
    }
    this.onEnd(commit)
  }
  private cancel = () => this.finish(false)
  private key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.dragging) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.finish(false)
  }

  dispose() {
    this.finish(false)
    this.scene.onBeforeRenderObservable.remove(this.frame)
    document.removeEventListener('keydown', this.key, true)
    document.removeEventListener('pointercancel', this.cancel, true)
    window.removeEventListener('blur', this.cancel)
    this.overlay.dispose()
    this.gizmos.dispose()
    this.layer.dispose()
    this.proxy.dispose()
  }
}
