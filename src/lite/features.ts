import type { SceneNode, TransformNode } from '@babylonjs/lite'
import Config from '../../common/config'
import { runCompute } from '../mono-pool'
import type { LiteParcel } from './parcel'
import { loadTex, quatYXZ, vec } from './utils'

const EPSILON = 0.01
let jobs = 0

// planes have no depth, scale.z is meaningless for them (Feature2D forces 1)
function place(node: SceneNode, f: any, flat = false) {
  const p = vec(f.position)
  const r = vec(f.rotation)
  const s = vec(f.scale)
  node.position.set(p[0], p[1], p[2])
  node.scaling.set(s[0] || EPSILON, s[1] || EPSILON, flat ? 1 : s[2] || EPSILON)
  node.rotationQuaternion.set(...quatYXZ(r[0], r[1], r[2]))
}

async function image(parcel: LiteParcel, f: any, parent: TransformNode) {
  const { L, engine } = parcel.lite
  if (!f.url) return
  // same compressor proxy babylon uses (avoids cors on arbitrary hosts) minus the ktx hint: lite decodes plain images
  let url: string
  try {
    url = new URL(f.url).toString()
  } catch (e) {
    return
  }
  if (process.env.TEXTURE_HOST) url = `${process.env.TEXTURE_HOST}/compressed?url=${encodeURIComponent(url)}&mode=${f.transparent ? 'transparent' : 'color'}${f.stretch ? '&stretch=true' : ''}&version=${Config.texture_cachebuster}`
  const tex = await loadTex(parcel.lite, url)
  if (!tex || parcel.disposed) return
  const m = L.createPlane(engine, { size: 1 })
  const mat = L.createStandardMaterial()
  mat.disableLighting = true
  mat.emissiveColor = [1, 1, 1]
  mat.backFaceCulling = false
  const a = parseFloat(f.opacity)
  mat.alpha = isNaN(a) ? 1 : a
  if (f.uScale && f.vScale) mat.uvScale = [parseFloat(f.uScale) || 1, parseFloat(f.vScale) || 1]
  mat.diffuseTexture = tex
  if (f.transparent) L.setStandardOpacityTexture(mat, tex)
  m.material = mat
  place(m, f, true)
  parcel.add(m, parent)
}

async function vox(parcel: LiteParcel, f: any, parent: TransformNode) {
  const { L, engine } = parcel.lite
  const url = f.url ? Config.voxModelURL(f.url, undefined, f.type === 'ride' ? 'megavox' : f.type) : `${process.env.ASSET_PATH}/models/vox-five.vox`
  let data: any
  try {
    data = await runCompute((w) => w.loadVox({ renderJob: jobs++, url, flipX: true, megavox: f.type !== 'vox-model', wantCollider: false, timeoutMs: 5000 }))
  } catch (e) {
    return
  }
  if (!data?.positions || parcel.disposed) return
  // the vox worker returns no normals and the colours already look shaded: unlit with zero normals.
  // small models come back as Uint16 indices, lite draws uint32 only
  const m = L.createMeshFromData(engine, 'vox', data.positions, new Float32Array(data.positions.length), new Uint32Array(data.indices), undefined, undefined, undefined, data.colors)
  const mat = L.createStandardMaterial()
  mat.disableLighting = true
  mat.emissiveColor = [1, 1, 1]
  m.material = mat
  place(m, f)
  parcel.add(m, parent)
}

export function liteFeatures(parcel: LiteParcel) {
  const { L } = parcel.lite
  const list: any[] = (parcel.record.features ?? []).filter(Boolean)
  const groups = new Map<string, TransformNode>()
  for (const f of list) {
    if (f.type !== 'group') continue
    const n = L.createTransformNode('group/' + f.uuid)
    place(n, f)
    groups.set(f.uuid, n)
  }
  const parentOf = (f: any) => (f.groupId && f.groupId !== f.uuid && groups.get(f.groupId)) || parcel.root
  for (const [uuid, n] of groups) n.parent = parentOf(list.find((f) => f.uuid === uuid))
  for (const f of list) {
    switch (f.type) {
      case 'image':
        void image(parcel, f, parentOf(f))
        break
      case 'vox-model':
      case 'megavox':
      case 'ride':
        void vox(parcel, f, parentOf(f))
        break
    }
  }
}
