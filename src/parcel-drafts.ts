import { runCompute } from './mono-pool'
import type { DraftBuffers, DraftJob } from './monoworker/drafts'
import type Parcel from './parcel'
import Feature from './features/feature'
import { rebindGizmos } from './tools/gizmos'
import { tidyVec3 } from './utils/helpers'

const IMAGE_TYPES = new Set(['image', 'nft-image'])
const VOX_TYPES = new Set(['vox-model', 'megavox', 'ride'])
const DRAFT_TYPES = new Set([...IMAGE_TYPES, ...VOX_TYPES])

let imageMat: BABYLON.StandardMaterial | null = null
let voxMat: BABYLON.StandardMaterial | null = null

function draftMaterials(scene: BABYLON.Scene) {
  if (!imageMat || imageMat.getScene() !== scene) {
    imageMat = new BABYLON.StandardMaterial('draft-image', scene)
    imageMat.disableLighting = true
    imageMat.emissiveColor.set(1, 1, 1)
    imageMat.diffuseColor.set(1, 1, 1)
    imageMat.specularColor.set(0, 0, 0)
    imageMat.backFaceCulling = false
    imageMat.freeze()
  }
  if (!voxMat || voxMat.getScene() !== scene) {
    voxMat = new BABYLON.StandardMaterial('draft-vox', scene)
    voxMat.specularColor.set(0, 0, 0)
    voxMat.freeze()
  }
  return { imageMat, voxMat }
}

function applyBuffers(mesh: BABYLON.Mesh, positions: Float32Array, colors: Float32Array, indices: Uint32Array) {
  const engine = mesh.getScene().getEngine()
  mesh.setVerticesBuffer(
    new BABYLON.VertexBuffer(engine, positions, BABYLON.VertexBuffer.PositionKind, {
      updatable: false,
      size: 3,
      type: BABYLON.VertexBuffer.FLOAT,
      normalized: false,
    }),
  )
  mesh.setVerticesBuffer(
    new BABYLON.VertexBuffer(engine, colors, BABYLON.VertexBuffer.ColorKind, {
      updatable: false,
      size: 4,
      type: BABYLON.VertexBuffer.FLOAT,
      normalized: false,
    }),
  )
  mesh.setIndices(indices)
  mesh.refreshBoundingInfo()
}

function applyMatrix(mesh: BABYLON.Mesh, m: Float32Array) {
  const mat = BABYLON.Matrix.FromArray(m as any)
  const scaling = new BABYLON.Vector3()
  const rotation = new BABYLON.Quaternion()
  const position = new BABYLON.Vector3()
  mat.decompose(scaling, rotation, position)
  mesh.position.copyFrom(position)
  mesh.rotationQuaternion = rotation
  mesh.scaling.copyFrom(scaling)
}

function jobsFrom(parcel: Parcel): DraftJob[] {
  const jobs: DraftJob[] = []
  for (const f of parcel.features) {
    if (!f?.uuid) continue
    // groups needed so the worker can resolve parent chains; drafts optional
    const isDraft = DRAFT_TYPES.has(f.type) && !!(f as any).draft
    const isGroup = f.type === 'group'
    if (!isDraft && !isGroup) continue
    jobs.push({
      uuid: f.uuid,
      type: f.type,
      draft: (f as any).draft,
      position: tidyVec3((f as any).position) as any,
      rotation: tidyVec3((f as any).rotation) as any,
      scale: tidyVec3((f as any).scale) as any,
      cubescale: !!(f as any).cubescale,
      groupId: (f as any).groupId || null,
    })
  }
  return jobs
}

export default class ParcelDrafts {
  private root: BABYLON.TransformNode | null = null
  private merged: BABYLON.Mesh | null = null
  private byUuid = new Map<string, BABYLON.Mesh>()
  private gen = 0
  private building: Promise<void> | null = null

  constructor(private parcel: Parcel) {}

  private ensureRoot() {
    if (this.root && !this.root.isDisposed()) return this.root
    this.root = new BABYLON.TransformNode(`drafts/${this.parcel.id}`, this.parcel.scene)
    this.root.parent = this.parcel.featureRoot
    return this.root
  }

  clear() {
    this.gen++
    this.merged?.dispose(false, false)
    this.merged = null
    for (const m of this.byUuid.values()) m.dispose(false, false)
    this.byUuid.clear()
    this.root?.dispose()
    this.root = null
    this.building = null
  }

  remove(uuid: string) {
    const m = this.byUuid.get(uuid)
    if (m) {
      m.dispose(false, false)
      this.byUuid.delete(uuid)
    }
  }

  take(feature: Feature): boolean {
    const m = this.byUuid.get(feature.uuid)
    if (!m) return false
    this.byUuid.delete(feature.uuid)
    m.rotationQuaternion = null
    feature.mesh = m
    rebindGizmos(feature)
    return true
  }

  async build() {
    const gen = ++this.gen
    const jobs = jobsFrom(this.parcel)
    if (!jobs.some((j) => j.draft && DRAFT_TYPES.has(j.type))) {
      this.clear()
      this.gen = gen
      return
    }

    const work = (async () => {
      const buffers = await runCompute((w) => w.meshDrafts(jobs, true))
      if (gen !== this.gen) return
      this.applyMerged(buffers)
    })()
    this.building = work
    await work
    if (this.building === work) this.building = null
  }

  async explode() {
    const gen = ++this.gen
    const jobs = jobsFrom(this.parcel)
    if (!jobs.some((j) => j.draft && DRAFT_TYPES.has(j.type))) {
      this.clear()
      this.gen = gen
      return
    }

    const buffers = await runCompute((w) => w.meshDrafts(jobs, false))
    if (gen !== this.gen) return
    this.applyExploded(buffers)
  }

  private applyMerged(buffers: DraftBuffers) {
    this.merged?.dispose(false, false)
    for (const m of this.byUuid.values()) m.dispose(false, false)
    this.byUuid.clear()
    this.merged = null

    if (!buffers.uuids.length) return

    const scene = this.parcel.scene
    const { imageMat, voxMat } = draftMaterials(scene)
    const root = this.ensureRoot()
    const mesh = new BABYLON.Mesh(`drafts-merged/${this.parcel.id}`, scene)
    applyBuffers(mesh, buffers.positions, buffers.colors, buffers.indices)

    const multi = new BABYLON.MultiMaterial(`drafts-multi/${this.parcel.id}`, scene)
    multi.subMaterials = [imageMat, voxMat]
    mesh.material = multi
    mesh.subMeshes = []
    const vertCount = buffers.positions.length / 3
    const indexCount = buffers.indices.length
    const imageEnd = Math.min(buffers.imageIndexEnd, indexCount)
    if (imageEnd > 0) {
      new BABYLON.SubMesh(0, 0, vertCount, 0, imageEnd, mesh)
    }
    if (imageEnd < indexCount) {
      new BABYLON.SubMesh(1, 0, vertCount, imageEnd, indexCount - imageEnd, mesh)
    }

    mesh.parent = root
    mesh.isPickable = false
    mesh.freezeWorldMatrix()
    this.merged = mesh
  }

  private applyExploded(buffers: DraftBuffers) {
    this.merged?.dispose(false, false)
    this.merged = null
    for (const m of this.byUuid.values()) m.dispose(false, false)
    this.byUuid.clear()

    if (!buffers.uuids.length) return

    const scene = this.parcel.scene
    const { imageMat, voxMat } = draftMaterials(scene)
    const root = this.ensureRoot()

    for (let i = 0; i < buffers.uuids.length; i++) {
      const uuid = buffers.uuids[i]
      const vertStart = buffers.ranges[i * 4]
      const vertCount = buffers.ranges[i * 4 + 1]
      const indexStart = buffers.ranges[i * 4 + 2]
      const indexCount = buffers.ranges[i * 4 + 3]
      if (!vertCount || !indexCount) continue

      const positions = buffers.positions.subarray(vertStart * 3, (vertStart + vertCount) * 3)
      const colors = buffers.colors.subarray(vertStart * 4, (vertStart + vertCount) * 4)
      const indices = new Uint32Array(indexCount)
      for (let j = 0; j < indexCount; j++) indices[j] = buffers.indices[indexStart + j] - vertStart

      const mesh = new BABYLON.Mesh(`draft/${this.parcel.id}/${uuid}`, scene)
      applyBuffers(mesh, positions, colors, indices)
      const isImage = indexStart < buffers.imageIndexEnd
      mesh.material = isImage ? imageMat : voxMat
      mesh.parent = root
      mesh.isPickable = true
      applyMatrix(mesh, buffers.matrices.subarray(i * 16, i * 16 + 16))
      this.byUuid.set(uuid, mesh)
    }
  }
}
