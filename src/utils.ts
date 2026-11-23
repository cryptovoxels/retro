import { FEATURE_LOD_DISTANCE } from './graphic/draw-distance'
import type Feature from './features/feature'

const frozenTransforms = new WeakSet<BABYLON.TransformNode>()
const cubeMaterials = new WeakMap<BABYLON.Scene, BABYLON.StandardMaterial>()
const staticFeatures = new Set(['image', 'nft-image', 'cube', 'sign', 'vox-model', 'megavox'])

export function featureLOD(feature: Feature) {
  if (!feature.mesh || feature.type === 'group') return
  for (const mesh of [feature.mesh, ...feature.mesh.getChildMeshes()]) {
    if (!(mesh instanceof BABYLON.Mesh)) continue
    mesh.removeLODLevel(null)
    if (feature.type === 'vox-model' || feature.type === 'megavox' || feature.type === 'ride') {
      if (mesh.metadata?.voxLOD) continue
      const scene = mesh.getScene(),
        bounds = mesh.getBoundingInfo().boundingBox
      let material = cubeMaterials.get(scene)
      if (!material) {
        material = new BABYLON.StandardMaterial('vox-lod', scene)
        material.specularColor.set(0, 0, 0)
        material.freeze()
        cubeMaterials.set(scene, material)
      }
      const size = bounds.extendSize.scale(2)
      // A face is an indexed triangle. Heavy models stay on LOD1 at every distance.
      const heavy = mesh.getTotalIndices() / 3 > 1000
      const cube = BABYLON.MeshBuilder.CreateBox(heavy ? 'vox-lod1' : 'vox-lod0', { width: size.x, height: size.y, depth: size.z }, scene)
      cube.position.copyFrom(bounds.center)
      cube.bakeCurrentTransformIntoVertices()
      cube.material = material
      cube.isPickable = false
      cube.metadata = { lod: heavy ? 1 : 0 }
      mesh.addLODLevel(heavy ? -1 : 16, cube)
      mesh.metadata = { ...mesh.metadata, voxLOD: true }
      mesh.onDisposeObservable.addOnce(() => cube.dispose())
    } else mesh.addLODLevel(FEATURE_LOD_DISTANCE, null)
  }
}

export function meshCandidates(scene: BABYLON.Scene) {
  const original = scene.getActiveMeshCandidates
  const candidates = new BABYLON.SmartArray<BABYLON.AbstractMesh>(256)
  const nearby = new BABYLON.SmartArray<BABYLON.AbstractMesh>(512)
  let refresh = 0
  const removed = scene.onMeshRemovedObservable.add(() => (refresh = 0))
  const planes = BABYLON.Frustum.GetPlanes(BABYLON.Matrix.Identity())
  scene.getActiveMeshCandidates = () => {
    const all = original.call(scene)
    if (scene.activeCamera instanceof BABYLON.WebXRCamera || scene.activeCamera?.rigParent instanceof BABYLON.WebXRCamera) {
      const now = performance.now()
      if (now >= refresh) {
        refresh = now + 250
        nearby.reset()
        const position = scene.activeCamera.globalPosition
        for (let i = 0; i < all.length; i++) {
          const mesh = all.data[i]
          // Keep terrain, moving features and instance sources. Rebuild detail candidates at 4 Hz.
          if ((mesh as any).feature && mesh.isWorldMatrixFrozen && !mesh.hasInstances && !mesh.actionManager && !mesh.alwaysSelectAsActiveMesh) {
            const sphere = mesh.getBoundingInfo().boundingSphere
            if (BABYLON.Vector3.DistanceSquared(position, sphere.centerWorld) > (12 + sphere.radiusWorld) ** 2) continue
          }
          nearby.push(mesh)
        }
      }
      return nearby
    }
    refresh = 0
    if (scene.skipFrustumClipping || (scene as any).customLODSelector || !scene.activeCamera) return all
    BABYLON.Frustum.GetPlanesToRef(scene.getTransformMatrix(), planes)
    candidates.reset()
    for (let i = 0; i < all.length; i++) {
      const mesh = all.data[i]
      // Instance sources and intersection actions still need Babylon's per-frame preparation.
      if (!mesh.isWorldMatrixFrozen || mesh.hasInstances || mesh.actionManager || mesh.alwaysSelectAsActiveMesh || mesh.isInFrustum(planes)) candidates.push(mesh)
    }
    return candidates
  }
  scene.onDisposeObservable.addOnce(() => {
    scene.getActiveMeshCandidates = original
    scene.onMeshRemovedObservable.remove(removed)
    candidates.dispose()
    nearby.dispose()
  })
}

export function thawFeature(feature: Feature) {
  if (!feature.mesh) return
  for (const node of [feature.mesh, ...feature.mesh.getDescendants()]) {
    if (node instanceof BABYLON.TransformNode && frozenTransforms.delete(node)) node.unfreezeWorldMatrix()
  }
}

export function freezeFeature(feature: Feature) {
  if (!feature.mesh || feature.disposed) return
  for (const node of [feature.mesh, ...feature.mesh.getDescendants()]) {
    if (!(node instanceof BABYLON.AbstractMesh)) continue
    const owner = (node as any).feature as Feature | undefined
    if (!owner || !staticFeatures.has(owner.type) || node.skeleton || node.billboardMode || (node as BABYLON.Mesh).morphTargetManager) continue
    let dynamic = false
    for (let parent: BABYLON.Node | null = node; parent; parent = parent.parent) {
      const f = (parent as any).feature as Feature | undefined
      if (parent.animations?.length || (parent instanceof BABYLON.TransformNode && parent.billboardMode) || f?.renderEditing || (f?.description as any)?.animation?.destination || f?.type === 'ride') {
        dynamic = true
        break
      }
    }
    if (dynamic) continue
    node.freezeWorldMatrix()
    frozenTransforms.add(node)
  }
}

export function chatStyle() {
  const body = getComputedStyle(document.body)
  const bar = document.querySelector('.interact-bar')
  const style = bar ? getComputedStyle(bar) : body
  return {
    font: body.fontFamily || 'sans-serif',
    background: style.getPropertyValue('--bg').trim() || style.backgroundColor,
    color: style.getPropertyValue('--fg').trim() || style.color,
    accent: style.getPropertyValue('--accent').trim() || style.color,
  }
}

export function chatLines(ctx: CanvasRenderingContext2D, text: string) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= 464) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word
    while (ctx.measureText(line).width > 464) {
      let end = line.length - 1
      while (end > 1 && ctx.measureText(line.slice(0, end)).width > 464) end--
      if (end > 1 && /[\uD800-\uDBFF]/.test(line[end - 1])) end--
      lines.push(line.slice(0, end))
      line = line.slice(end)
    }
  }
  if (line) lines.push(line)
  if (lines.length > 3) {
    lines.length = 3
    while (ctx.measureText(lines[2] + '...').width > 464) lines[2] = lines[2].slice(0, -1)
    lines[2] += '...'
  }
  return lines
}

export function featureOrder(features: import('../common/messages/feature').FeatureRecord[]) {
  const byId = new Map(features.filter(Boolean).map((f) => [f.uuid, f]))
  const seen = new Set<string | undefined>()
  const ordered: typeof features = []
  const visit = (feature: (typeof features)[number]) => {
    if (seen.has(feature.uuid)) return
    seen.add(feature.uuid)
    const parent = feature.groupId && byId.get(feature.groupId)
    if (parent && parent.type === 'group') visit(parent)
    ordered.push(feature)
  }
  for (const feature of byId.values()) visit(feature)
  return ordered
}

export function rgbaPixels(rgb: Uint8Array, rgba = new Uint8Array((rgb.length / 3) * 4)) {
  for (let i = 0, j = 0; i < rgb.length && j < rgba.length; i += 3, j += 4) {
    rgba[j] = rgb[i]
    rgba[j + 1] = rgb[i + 1]
    rgba[j + 2] = rgb[i + 2]
    rgba[j + 3] = 255
  }
  return rgba
}

export function instanceKey(feature: import('../common/messages/feature').FeatureRecord) {
  if (!['image', 'vox-model', 'cube', 'megavox'].includes(feature.type)) return undefined
  const { uuid, position, rotation, scale, groupId, version, collidable, animation, ...appearance } = feature as any
  if (typeof animation === 'string') appearance.animation = animation
  return JSON.stringify(appearance, (_key, value) => (value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value))
}
