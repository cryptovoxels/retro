import { signal } from '@preact/signals'
import type { Costume, CostumeAttachment } from '../../common/messages/costumes'
import { Animations } from '../avatar-animations'
import Orbit from '../controls/orbit'
import Transform from './transform'
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
  private transform?: Transform
  private frame?: BABYLON.Observer<BABYLON.Scene>
  private pointer?: BABYLON.Observer<BABYLON.PointerInfo>
  private saved = false
  private pose: Array<{ node: BABYLON.TransformNode; rotation: BABYLON.Quaternion }> = []

  constructor(costume: Costume) {
    this.draft = {
      ...costume,
      attachments: costume.attachments?.map(({ bone, wid, position, rotation, scaling, wearable }) => ({ bone: bone.toLowerCase(), wid, position: [...position], rotation: [...rotation], scaling: [...scaling], wearable })) ?? [],
    }
    this.selected.value = this.draft.attachments?.length ? 0 : -1
  }

  activate() {
    this.enabled.value = true
    costumeTool.value = this
    const scene = this.avatar.avatarMesh!.getScene()
    this.transform = new Transform(scene)
    this.transform.onEnd = (commit) => {
      if (!commit) return
      const mesh = this.manager.attachments[this.selected.value]?.mesh
      const attachment = this.draft.attachments?.[this.selected.value]
      if (!mesh || !attachment) return
      this.update({
        ...attachment,
        position: mesh.position.asArray(),
        rotation: (mesh.rotationQuaternion?.toEulerAngles() ?? mesh.rotation).asArray().map((v) => (v * 180) / Math.PI),
        scaling: mesh.scaling.asArray(),
      })
    }
    this.mode('position')
    const startPose = (this.avatar.skeleton?.bones ?? []).flatMap((bone) => {
      const node = bone.getTransformNode()
      return node?.rotationQuaternion ? [{ node, position: node.position.clone(), rotation: node.rotationQuaternion.clone(), scaling: node.scaling.clone() }] : []
    })
    let blend = 0
    this.orbit = new Orbit(window.connector.controls, () => !!this.transform?.over())
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
      if (blend < 1) {
        blend = Math.min(1, blend + scene.getEngine().getDeltaTime() / 400)
        const amount = blend * blend * (3 - 2 * blend)
        for (const { node, position, rotation, scaling } of startPose) {
          BABYLON.Vector3.LerpToRef(position, node.position, amount, node.position)
          BABYLON.Quaternion.SlerpToRef(rotation, node.rotationQuaternion!, amount, node.rotationQuaternion!)
          BABYLON.Vector3.LerpToRef(scaling, node.scaling, amount, node.scaling)
        }
      }
      for (const attachment of this.manager.attachments) if (attachment.mesh) attachment.mesh.isPickable = true
      const selected = this.manager.attachments[this.selected.value]?.mesh ?? null
      this.transform?.attach(selected)
    })
    this.pointer = scene.onPointerObservable.add((info) => {
      if (info.type !== BABYLON.PointerEventTypes.POINTERTAP || info.event.button !== 0) return
      const index = this.manager.attachments.findIndex((a) => a.mesh === info.pickInfo?.pickedMesh)
      if (index >= 0) this.selected.value = index
    })
    document.addEventListener('keydown', this.key, true)
    this.manager.generateCostume(this.draft, true)
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
    this.transform?.mode(mode)
  }

  update(attachment: CostumeAttachment) {
    const index = this.selected.value
    if (!this.draft.attachments?.[index]) return
    const previous = this.draft.attachments[index]
    this.draft.attachments[index] = attachment
    if (previous.wid !== attachment.wid || previous.bone !== attachment.bone) {
      this.transform?.attach(null)
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
    this.transform?.attach(null)
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
    this.transform?.dispose()
    this.avatar.animationOverride = this.animation
    this.orbit?.dispose()
    this.manager.generateCostume(this.saved && this.original?.id === this.draft.id ? this.draft : (this.original ?? undefined), true)
    costumeTool.value = null
    if (uiPane.value === 'costume') uiPane.value = undefined
  }
}
