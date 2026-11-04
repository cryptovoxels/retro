import { signal } from '@preact/signals'
import type { Costume, CostumeAttachment } from '../../common/messages/costumes'
import { Animations } from '../avatar-animations'
import Orbit from '../controls/orbit'
import { uiPane } from '../store'

export const costumeTool = signal<CostumeTool | null>(null)

export default class CostumeTool {
  enabled = signal(false)
  selected = signal(-1)
  revision = signal(0)
  modeValue = signal<'position' | 'rotation' | 'scale'>('position')
  draft: Costume
  private avatar = window.connector.persona.avatar!
  private manager = this.avatar.attachmentManager!
  private original = this.manager.costume
  private animation = this.avatar.animationOverride
  private orbit?: Orbit
  private layer?: BABYLON.UtilityLayerRenderer
  private gizmos?: BABYLON.GizmoManager
  private frame?: BABYLON.Observer<BABYLON.Scene>
  private pointer?: BABYLON.Observer<BABYLON.PointerInfo>
  private dragging = false
  private proxy?: BABYLON.Mesh
  private parentInverse = BABYLON.Matrix.Identity()
  private saved = false
  private pose: Array<{ node: BABYLON.TransformNode; rotation: BABYLON.Quaternion }> = []

  constructor(costume: Costume) {
    this.draft = {
      ...costume,
      attachments: costume.attachments?.map(({ bone, wid, position, rotation, scaling, wearable }) => ({ bone: bone.toLowerCase(), wid, position: [...position], rotation: [...rotation], scaling: [...scaling], wearable })) ?? [],
    }
  }

  activate() {
    this.enabled.value = true
    costumeTool.value = this
    const scene = this.avatar.avatarMesh!.getScene()
    this.proxy = new BABYLON.Mesh('costume/gizmo', scene)
    this.proxy.rotationQuaternion = BABYLON.Quaternion.Identity()
    this.layer = new BABYLON.UtilityLayerRenderer(scene)
    this.gizmos = new BABYLON.GizmoManager(scene, 1, this.layer)
    this.gizmos.usePointerToAttachGizmos = false
    this.gizmos.positionGizmoEnabled = true
    this.gizmos.rotationGizmoEnabled = true
    this.gizmos.scaleGizmoEnabled = true
    for (const gizmo of [this.gizmos.gizmos.positionGizmo, this.gizmos.gizmos.rotationGizmo, this.gizmos.gizmos.scaleGizmo]) {
      gizmo?.onDragStartObservable.add(() => {
        this.dragging = true
      })
      gizmo?.onDragObservable.add(() => this.applyProxy())
      gizmo?.onDragEndObservable.add(() => {
        this.dragging = false
        const mesh = this.manager.attachments[this.selected.value]?.mesh
        const attachment = this.draft.attachments?.[this.selected.value]
        if (!mesh || !attachment) return
        attachment.position = mesh.position.asArray()
        attachment.rotation = (mesh.rotationQuaternion?.toEulerAngles() ?? mesh.rotation).asArray().map((v) => (v * 180) / Math.PI)
        attachment.scaling = mesh.scaling.asArray()
        this.revision.value++
      })
    }
    this.mode('position')
    this.orbit = new Orbit(window.connector.controls, () => this.dragging || !!this.gizmos?.utilityLayer.utilityLayerScene.pick(scene.pointerX, scene.pointerY)?.hit)
    this.avatar.animationOverride = Animations.Tpose
    this.frame = scene.onAfterAnimationsObservable.add(() => {
      this.avatar.skeleton?.returnToRest()
      if (!this.pose.length) {
        for (const side of ['left', 'right']) {
          const arm = this.avatar.skeleton?.bones.find((b) => b.name === `${side}arm`)?.getTransformNode()
          const forearm = this.avatar.skeleton?.bones.find((b) => b.name === `${side}forearm`)?.getTransformNode()
          if (!arm?.rotationQuaternion || !forearm || !arm.parent) continue
          const parent = arm.parent as BABYLON.TransformNode
          const world = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(side === 'left' ? 1 : -1, 0, 0), this.avatar.avatarMesh!.computeWorldMatrix(true))
          const target = BABYLON.Vector3.TransformNormal(world, parent.computeWorldMatrix(true).clone().invert()).normalize()
          const current = forearm.position.clone().normalize().rotateByQuaternionToRef(arm.rotationQuaternion, BABYLON.Vector3.Zero())
          const rotation = BABYLON.Quaternion.FromUnitVectorsToRef(current, target, new BABYLON.Quaternion()).multiply(arm.rotationQuaternion)
          this.pose.push({ node: arm, rotation })
        }
      }
      for (const { node, rotation } of this.pose) node.rotationQuaternion?.copyFrom(rotation)
      for (const attachment of this.manager.attachments) if (attachment.mesh) attachment.mesh.isPickable = true
      const selected = this.manager.attachments[this.selected.value]?.mesh ?? null
      if (selected && this.proxy && !this.dragging) {
        const world = selected.computeWorldMatrix(true)
        const rotation = selected.rotationQuaternion ?? BABYLON.Quaternion.FromEulerVector(selected.rotation)
        const local = selected.getPivotMatrix().multiply(BABYLON.Matrix.Compose(selected.scaling, rotation, selected.position))
        this.parentInverse.copyFrom(local.invert().multiply(world).invert())
        world.decompose(this.proxy.scaling, this.proxy.rotationQuaternion!, this.proxy.position)
      }
      const target = selected ? this.proxy! : null
      if (this.gizmos?.attachedMesh !== target) this.gizmos?.attachToMesh(target)
    })
    this.pointer = scene.onPointerObservable.add((info) => {
      if (info.type !== BABYLON.PointerEventTypes.POINTERTAP || info.event.button !== 0) return
      const index = this.manager.attachments.findIndex((a) => a.mesh === info.pickInfo?.pickedMesh)
      if (index >= 0) this.selected.value = index
    })
    document.addEventListener('keydown', this.key, true)
    this.manager.generateCostume(this.draft, true)
  }

  // Babylon gizmos cannot decompose bone parents. Edit a world-space proxy, then
  // remove the bone transform and the importer's voxel pre-transform.
  private applyProxy() {
    const mesh = this.manager.attachments[this.selected.value]?.mesh
    if (!mesh || !this.proxy) return
    const local = mesh.getPivotMatrix().clone().invert().multiply(this.proxy.computeWorldMatrix(true).multiply(this.parentInverse))
    const rotation = BABYLON.Quaternion.Identity()
    local.decompose(mesh.scaling, rotation, mesh.position)
    mesh.rotationQuaternion = null
    rotation.toEulerAnglesToRef(mesh.rotation)
  }

  private key = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    e.stopImmediatePropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      this.close()
    }
  }

  mode(mode: 'position' | 'rotation' | 'scale') {
    this.modeValue.value = mode
    if (!this.gizmos) return
    this.gizmos.positionGizmoEnabled = mode === 'position'
    this.gizmos.rotationGizmoEnabled = mode === 'rotation'
    this.gizmos.scaleGizmoEnabled = mode === 'scale'
  }

  update(attachment: CostumeAttachment) {
    const index = this.selected.value
    if (!this.draft.attachments?.[index]) return
    const previous = this.draft.attachments[index]
    this.draft.attachments[index] = attachment
    if (previous.wid !== attachment.wid || previous.bone !== attachment.bone) {
      this.gizmos?.attachToMesh(null)
      this.manager.generateCostume(this.draft, true)
    } else {
      const current = this.manager.attachments[index]
      if (current) Object.assign(current, attachment)
      const mesh = current?.mesh
      if (mesh) {
        mesh.position.fromArray(attachment.position)
        mesh.scaling.fromArray(attachment.scaling)
        mesh.rotationQuaternion = null
        mesh.rotation.fromArray(attachment.rotation.map((v) => (v * Math.PI) / 180))
      }
    }
    this.revision.value++
  }

  add(bone: string) {
    if ((this.draft.attachments?.length ?? 0) >= 12) return
    this.draft.attachments!.push({ bone, wid: '', position: [0, 0, 0], rotation: [0, 0, 0], scaling: [0.5, 0.5, 0.5] })
    this.selected.value = this.draft.attachments!.length - 1
    this.revision.value++
  }

  remove() {
    this.draft.attachments?.splice(this.selected.value, 1)
    this.selected.value = -1
    this.gizmos?.attachToMesh(null)
    this.manager.generateCostume(this.draft, true)
    this.revision.value++
  }

  commit() {
    this.saved = true
    this.close()
  }
  close() {
    if (window.ui?.activeTool === this) window.ui.setTool(null)
    if (uiPane.value === 'costume') uiPane.value = undefined
  }

  deactivate() {
    if (!this.enabled.value) return
    this.enabled.value = false
    document.removeEventListener('keydown', this.key, true)
    const scene = this.avatar.avatarMesh?.getScene()
    if (this.frame) scene?.onAfterAnimationsObservable.remove(this.frame)
    if (this.pointer) scene?.onPointerObservable.remove(this.pointer)
    this.gizmos?.dispose()
    this.layer?.dispose()
    this.proxy?.dispose()
    this.avatar.animationOverride = this.animation
    this.orbit?.dispose()
    this.manager.generateCostume(this.saved && this.original?.id === this.draft.id ? this.draft : (this.original ?? undefined), true)
    costumeTool.value = null
    if (uiPane.value === 'costume') uiPane.value = undefined
  }
}
