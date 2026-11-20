import { VoxImporter } from '../common/vox-import/vox-import'
import type { CritterPose } from '../common/messages'

import * as rat from './rigs/rat.rig.lua'
import * as eagle from './rigs/eagle.rig.lua'

const rigs = new Map([
  ['rat', rat],
  ['eagle', eagle],
])
type Model = { nodes: BABYLON.TransformNode[]; pos: BABYLON.Vector3; rot: BABYLON.Vector3; target: BABYLON.Vector3; pose: CritterPose; phase: number; rig: typeof rat }
export class Critters {
  private models = new Map<string, Promise<BABYLON.Mesh>>()
  private actors = new Map<number, Model>()
  private importer = new VoxImporter()
  private loads = new AbortController()
  private frame?: BABYLON.Observer<BABYLON.Scene>

  constructor(private scene: BABYLON.Scene) {
    this.importer.initialize(scene)
    scene.onDisposeObservable.addOnce(() => this.loads.abort())
  }

  update(poses: CritterPose[]) {
    const seen = new Set<number>()
    for (const pose of poses) {
      const [id, model, position] = pose
      const rig = rigs.get(model)
      if (!rig) continue
      seen.add(id)
      const actor = this.actors.get(id) ?? this.create(pose, rig)
      actor.pose = pose
      actor.target.set(...position)
    }
    for (const [id, actor] of this.actors)
      if (!seen.has(id)) {
        for (const node of actor.nodes) if (!node.parent) node.dispose()
        this.actors.delete(id)
      }
    if (!this.actors.size) {
      this.frame?.remove()
      this.frame = undefined
    } else if (!this.frame)
      this.frame = this.scene.onBeforeRenderObservable.add(() => {
        const dt = Math.min(1, this.scene.getEngine().getDeltaTime() / 125)
        for (const actor of this.actors.values()) {
          const { pos, rot, target, pose } = actor
          BABYLON.Vector3.LerpToRef(pos, target, dt, pos)
          for (let i = 0; i < 3; i++) {
            const axis = axes[i],
              diff = pose[3][i] - rot[axis]
            rot[axis] += Math.atan2(Math.sin(diff), Math.cos(diff)) * dt
          }
          const delta = pose[4] - actor.phase
          actor.phase += Math.atan2(Math.sin(delta), Math.cos(delta)) * dt
          actor.rig.animate(actor.nodes, pos, rot, actor.phase)
        }
      })
  }

  private create(pose: CritterPose, rig: typeof rat): Model {
    const [id, model, pos, rot, phase] = pose
    const nodes: BABYLON.TransformNode[] = []
    for (const part of rig.parts) {
      const asset = typeof part.asset === 'string' ? part.asset : part.asset[id % part.asset.length]
      const joint = new BABYLON.TransformNode(part.parent == null ? model + '-' + id : part.name, this.scene)
      nodes.push(joint)
      if (part.parent != null) joint.parent = nodes[part.parent]
      if (part.position) joint.position.set(...part.position)
      if (part.mirror) joint.scaling.x = -1
      let loading = this.models.get(asset)
      if (!loading) {
        loading = this.importer
          .import('https://ugc.voxels.com/artpacks/texas/v1/critters/' + asset + '.vox', { signal: this.loads.signal, invertX: false })
          .then((mesh) => {
            mesh.setEnabled(false)
            mesh.material?.freeze()
            return mesh
          })
          .catch((error) => {
            this.models.delete(asset)
            throw error
          })
        this.models.set(asset, loading)
      }
      loading
        .then((source) => {
          if (joint.isDisposed()) return
          const mesh = source.clone(part.name, joint, true)!
          mesh.position.set(...(part.offset ?? ([0, 0, 0] as const)))
          mesh.setEnabled(true)
        })
        .catch(() => {})
    }
    const actor = { nodes, pos: new BABYLON.Vector3(...pos), rot: new BABYLON.Vector3(...rot), target: new BABYLON.Vector3(...pos), rig, pose, phase }
    rig.animate(nodes, actor.pos, actor.rot, phase)
    this.actors.set(id, actor)
    return actor
  }
}
const axes = ['x', 'y', 'z'] as const
