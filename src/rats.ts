import { VoxImporter } from '../common/vox-import/vox-import'
import type { MeshExtended } from './features/feature'
import { app } from '../web/src/state'
import type { RatPose } from '../common/messages'

type Rat = {
  body: BABYLON.TransformNode
  target: BABYLON.Vector3
  wings?: BABYLON.TransformNode[]
  tail?: BABYLON.TransformNode
  hat?: BABYLON.TransformNode
  chip?: BABYLON.TransformNode
  pose: RatPose
}

export class Rats {
  private rats = new Map<number, Rat>()
  private frame: BABYLON.Observer<BABYLON.Scene> | null = null
  private dialog?: HTMLDialogElement
  private models = new Map<string, Promise<BABYLON.Mesh>>()
  private importer = new VoxImporter()
  private loads = new AbortController()

  constructor(
    private scene: BABYLON.Scene,
    private dress: (id: number, name: string, cap: boolean) => void,
  ) {
    this.importer.initialize(scene)
    scene.onDisposeObservable.addOnce(() => this.loads.abort())
  }

  update(poses: RatPose[]) {
    for (const [id, rat] of this.rats) {
      if (poses.some((p) => p[0] === id)) continue
      rat.body.dispose()
      this.rats.delete(id)
    }
    for (const pose of poses) {
      const [id, x, y, z, carrying, , , cap] = pose
      const rat = this.rats.get(id) ?? this.create(pose)
      rat.pose = pose
      rat.target.set(x, y, z)
      rat.chip?.setEnabled(carrying)
      rat.hat?.setEnabled(cap)
    }
    if (!poses.length) {
      this.frame?.remove()
      this.frame = null
      this.dialog?.close()
    } else if (!this.frame) {
      this.frame = this.scene.onBeforeRenderObservable.add(() => {
        const dt = Math.min(1, this.scene.getEngine().getDeltaTime() / 125)
        const beat = performance.now() * 0.023
        for (const { body, target, tail, wings, pose } of this.rats.values()) {
          const dx = target.x - body.position.x,
            dz = target.z - body.position.z
          const moving = dx * dx + dz * dz > 0.0001
          if (moving) body.rotation.y = Math.atan2(dx, dz)
          body.rotation.z = moving ? Math.sin(beat + pose[0]) * 0.06 : 0
          if (wings) {
            const flap = Math.sin(beat * 0.4 + pose[0]) * 0.35
            wings[0].rotation.z = -flap
            wings[1].rotation.z = flap
            body.rotation.x = -Math.atan2(target.y - body.position.y, Math.max(0.01, Math.hypot(dx, dz))) * 0.6
          }
          if (tail) tail.rotation.y = moving ? Math.sin(beat + pose[0]) * 0.22 : 0.12
          BABYLON.Vector3.LerpToRef(body.position, target, dt, body.position)
        }
      })
    }
  }

  private create(pose: RatPose): Rat {
    const [id, x, y, z] = pose
    const body = new BABYLON.TransformNode(pose[8] ? pose[5] : 'rat-' + id, this.scene)
    body.position.set(x, y, z)
    const part = (asset: string, name: string, x: number, y: number, z: number, offset = 0, back = 0) => {
      const joint = new BABYLON.TransformNode(name, this.scene)
      joint.parent = body
      joint.position.set(x, y, z)
      let model = this.models.get(asset)
      if (!model) {
        model = this.importer
          .import('/models/critters/' + asset + '.vox', { signal: this.loads.signal, invertX: false })
          .then((mesh) => {
            mesh.setEnabled(false)
            mesh.material?.freeze()
            return mesh
          })
          .catch((error) => {
            this.models.delete(asset)
            throw error
          })
        this.models.set(asset, model)
      }
      model
        .then((source) => {
          if (joint.isDisposed()) return
          const mesh = source.clone(name, joint, true) as MeshExtended
          mesh.position.set(offset, 0, back)
          mesh.setEnabled(true)
          mesh.cvOnLeftClick = () => this.inspect(id)
        })
        .catch(() => {})
      return joint
    }
    if (pose[8] === 'eagle') {
      part('eagle', 'eagle body', 0, -0.22, 0)
      const wings = [-1, 1].map((side) => {
        const wing = part('eagle-wing', 'wing', side * 0.11, 0.045, 0, 0.54)
        wing.scaling.x = side
        return wing
      })
      const eagle = { body, target: body.position.clone(), wings, pose }
      this.rats.set(id, eagle)
      return eagle
    }
    part('rat-' + (id % 3), 'rat body', 0, 0, 0)
    const tail = part('rat-tail', 'tail', 0, 0.045, -0.29, 0, -0.18)
    const hat = part('rat-cap', 'red cap', 0, 0.263, 0.22)
    const chip = part('chip', 'chip', 0, 0.098, 0.46)
    const rat = { body, target: body.position.clone(), tail, hat, chip, pose }
    this.rats.set(id, rat)
    return rat
  }

  private inspect(id: number) {
    const rat = this.rats.get(id)
    if (!rat || this.dialog?.open) return
    if (rat.pose[8] === 'eagle') {
      app.showSnackbar(rat.pose[5])
      return
    }
    const [, , , , , name, by, cap] = rat.pose
    document.exitPointerLock?.()
    const dialog = document.createElement('dialog')
    const form = document.createElement('form')
    form.method = 'dialog'
    const title = document.createElement('p')
    title.textContent = by ? name + ' named by ' + by : name
    const nameLabel = document.createElement('label')
    nameLabel.textContent = 'Name '
    const input = document.createElement('input')
    input.value = name
    input.maxLength = 40
    input.required = true
    nameLabel.append(input)
    const hatLabel = document.createElement('label')
    const hat = document.createElement('input')
    hat.type = 'checkbox'
    hat.checked = cap
    hatLabel.append(hat, ' Red cap')
    const save = document.createElement('button')
    save.textContent = app.state.wallet ? 'Save' : 'Log in to edit'
    save.disabled = !app.state.wallet
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close'
    close.onclick = () => dialog.close()
    form.onsubmit = () => this.dress(id, input.value, hat.checked)
    form.append(title, nameLabel, hatLabel, save, close)
    dialog.append(form)
    dialog.onclose = () => {
      dialog.remove()
      this.dialog = undefined
    }
    document.body.append(dialog)
    this.dialog = dialog
    dialog.showModal()
  }
}
