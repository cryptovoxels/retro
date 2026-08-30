import type { Document } from '@gltf-transform/core'
import { humanoidBones } from './vrm-bones'

const REQUIRED_BONES = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'] as const

const MAX_TEXTURES = 1
const MAX_MATERIALS = 2
const MAX_TRIANGLES = 5000
const MAX_JOINTS = 100
const MAX_BYTES = 5 * 1024 * 1024
const MIN_HEIGHT = 1
const MAX_HEIGHT = 2
const MAX_FOOTPRINT = 2

export type CompileVrmResult = {
  bytes: Uint8Array | null
  errors: string[]
}

async function loadLibs() {
  const [{ WebIO }, functions, vrmExt, { MeshoptSimplifier, MeshoptEncoder }] = await Promise.all([import('@gltf-transform/core'), import('@gltf-transform/functions'), import('gltf-transform-vrm-extensions'), import('meshoptimizer')])
  return { WebIO, functions, vrmExt, MeshoptSimplifier, MeshoptEncoder }
}

function countTriangles(doc: Document): number {
  let tris = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      if (indices) {
        tris += indices.getCount() / 3
        continue
      }
      const pos = prim.getAttribute('POSITION')
      if (pos) tris += pos.getCount() / 3
    }
  }
  return Math.floor(tris)
}

function countJoints(doc: Document): number {
  let n = 0
  for (const skin of doc.getRoot().listSkins()) {
    n += skin.listJoints().length
  }
  return n
}

function humanoidFromDoc(doc: Document): Record<string, string> {
  const root = doc.getRoot() as any
  // legacy VRM 0.x: humanBones is an array of { bone, node } with raw node indices
  const legacy = root.listExtensionsUsed?.()?.find((e: any) => e.extensionName === 'VRM')
  const bonesArr = legacy?.data?.humanoid?.humanBones
  if (!Array.isArray(bonesArr)) return {}
  const nodes = root.listNodes()
  const out: Record<string, string> = {}
  for (const b of bonesArr) {
    const node = typeof b?.node === 'number' ? nodes[b.node] : null
    if (b?.bone && node) out[b.bone] = node.getName()
  }
  return out
}

function hasExt(doc: Document, name: string): boolean {
  return doc
    .getRoot()
    .listExtensionsUsed()
    .some((e) => e.extensionName === name)
}

export function vrmTest(doc: Document, compiledBytes?: number): string[] {
  const errors: string[] = []

  if (hasExt(doc, 'VRMC_vrm') && !hasExt(doc, 'VRM')) {
    errors.push('this is VRM 1.0 - re-export as VRM 0.x')
    return errors
  }
  if (!hasExt(doc, 'VRM')) {
    errors.push('not a VRM 0.x file (missing VRM)')
    return errors
  }

  const humanoid = humanoidFromDoc(doc)
  for (const bone of REQUIRED_BONES) {
    if (!humanoid[bone]) errors.push(`missing humanoid bone: ${bone}`)
  }

  const textures = doc.getRoot().listTextures().length
  if (textures > MAX_TEXTURES) errors.push(`${textures} textures (max ${MAX_TEXTURES})`)

  const materials = doc.getRoot().listMaterials().length
  if (materials > MAX_MATERIALS) errors.push(`${materials} materials (max ${MAX_MATERIALS})`)

  const tris = countTriangles(doc)
  if (tris > MAX_TRIANGLES) errors.push(`${tris} triangles (max ${MAX_TRIANGLES})`)

  const joints = countJoints(doc)
  if (joints > MAX_JOINTS) errors.push(`${joints} joints (max ${MAX_JOINTS})`)

  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]
  if (scene) {
    // getBounds imported lazily via caller; we compute AABB from POSITION attrs if needed below
  }

  if (compiledBytes != null && compiledBytes > MAX_BYTES) {
    errors.push(`compiled size ${(compiledBytes / 1024 / 1024).toFixed(1)}MB (max 5MB)`)
  }

  return errors
}

async function boundsErrors(doc: Document, getBounds: (n: any) => { min: number[]; max: number[] }): Promise<string[]> {
  const errors: string[] = []
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]
  if (!scene) {
    errors.push('no scene')
    return errors
  }
  const { min, max } = getBounds(scene)
  const sx = max[0] - min[0]
  const sy = max[1] - min[1]
  const sz = max[2] - min[2]
  if (sy < MIN_HEIGHT) errors.push(`height ${sy.toFixed(2)}m under ${MIN_HEIGHT}m`)
  if (sy > MAX_HEIGHT) errors.push(`height ${sy.toFixed(2)}m over ${MAX_HEIGHT}m`)
  if (sx > MAX_FOOTPRINT || sz > MAX_FOOTPRINT) {
    errors.push(`footprint ${sx.toFixed(2)}x${sz.toFixed(2)} outside ${MAX_FOOTPRINT}x${MAX_FOOTPRINT}`)
  }
  // overall box must fit in 2x2x2
  if (sx > MAX_FOOTPRINT || sy > MAX_FOOTPRINT || sz > MAX_FOOTPRINT) {
    // height already checked separately; footprint covers xz. keep one clear msg for full box.
  }
  return errors
}

/** Merge prims to cut draw calls. join() skips skinned nodes, so do it by hand:
 * within each mesh (skin is constant) group by material, skip morph targets
 * (joinPrimitives refuses them - keeps the VRoid face prim separate), merge each
 * group of 2+. Nodes are untouched, so 0.x humanoid node indices stay valid. */
function mergePrims(doc: Document, joinPrimitives: (prims: any[]) => any) {
  for (const mesh of doc.getRoot().listMeshes()) {
    const groups = new Map<any, any[]>()
    for (const prim of mesh.listPrimitives()) {
      if (prim.listTargets().length) continue
      const mat = prim.getMaterial()
      const arr = groups.get(mat)
      if (arr) arr.push(prim)
      else groups.set(mat, [prim])
    }
    for (const prims of groups.values()) {
      if (prims.length < 2) continue
      let merged: any
      try {
        merged = joinPrimitives(prims)
      } catch {
        continue
      }
      for (const p of prims) p.dispose()
      mesh.addPrimitive(merged)
    }
  }
}

export async function compileVrm(file: File): Promise<CompileVrmResult> {
  const { WebIO, functions, vrmExt, MeshoptSimplifier, MeshoptEncoder } = await loadLibs()
  const io = new WebIO().registerExtensions(vrmExt.VRMC_VRM_EXTENSIONS)

  let doc: Document
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    doc = await io.readBinary(buf)
  } catch (e) {
    return { bytes: null, errors: [`failed to read VRM: ${e instanceof Error ? e.message : String(e)}`] }
  }

  const early = vrmTest(doc)
  if (early.some((e) => e.includes('VRM 1.0') || e.includes('not a VRM'))) {
    return { bytes: null, errors: early }
  }

  try {
    await MeshoptEncoder.ready
    const trisBefore = countTriangles(doc)
    const pre: any[] = [functions.dedup(), functions.weld()]
    if (trisBefore > MAX_TRIANGLES) {
      const ratio = Math.max(0.05, MAX_TRIANGLES / trisBefore)
      pre.push(functions.simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }))
    }
    await doc.transform(...pre)
    mergePrims(doc, functions.joinPrimitives)
    // keepLeaves: raw node indices in the legacy VRM humanoid block must not shift
    await doc.transform(functions.prune({ keepLeaves: true }), functions.textureCompress({ targetFormat: 'webp', resize: [1024, 1024] }), functions.reorder({ encoder: MeshoptEncoder }))
  } catch (e) {
    return { bytes: null, errors: [`compile failed: ${e instanceof Error ? e.message : String(e)}`] }
  }

  const errors = [...vrmTest(doc), ...(await boundsErrors(doc, functions.getBounds))]
  if (errors.length) return { bytes: null, errors }

  let bytes: Uint8Array
  try {
    bytes = await io.writeBinary(doc)
  } catch (e) {
    return { bytes: null, errors: [`write failed: ${e instanceof Error ? e.message : String(e)}`] }
  }

  if (bytes.byteLength > MAX_BYTES) {
    return { bytes: null, errors: [`compiled size ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB (max 5MB)`] }
  }

  // canary: a shifted node index silently breaks the humanoid map - catch it here
  const map = humanoidBones(bytes.buffer as ArrayBuffer)
  for (const bone of REQUIRED_BONES) {
    if (!map[bone]) return { bytes: null, errors: [`compile corrupted humanoid (missing ${bone})`] }
  }

  return { bytes, errors: [] }
}
