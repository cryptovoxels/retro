import type { FeatureRecord } from '../../common/messages/feature'
import type Feature from '../features/feature'

// Furniture is island-local. The decorative feature types only need a transform and a scene.
export async function islandFurniture(mesh: BABYLON.Mesh, name: string, content?: { origin?: number[]; features?: FeatureRecord[] }) {
  if (!content?.features?.length) return
  const { createFeature } = await import('../features/create')
  if (mesh.isDisposed()) return
  const scene = mesh.getScene()
  const root = new BABYLON.TransformNode('furniture/' + name, scene)
  root.parent = mesh
  root.position.copyFromFloats(content.origin?.[0] || 0, -mesh.position.y, content.origin?.[2] || 0)
  const features: Feature[] = []
  const owner = { id: 'island/' + name, grid: window.grid, canEdit: false, featureRoot: root, transform: root, featuresList: features }
  mesh.onDisposeObservable.addOnce(() => {
    for (const f of features) f.dispose()
    features.length = 0
    root.dispose()
  })
  const batch: Promise<void>[] = []
  for (let i = 0; i < content.features.length; i++) {
    if (batch.length === 24) {
      await Promise.all(batch)
      batch.length = 0
    }
    if (mesh.isDisposed()) return
    const record = content.features[i]
    if (!record.uuid || !['cube', 'lantern', 'vox-model'].includes(record.type)) continue
    const f = createFeature(scene, owner as any, record.uuid, record)
    features.push(f)
    batch.push(
      f
        .generate()
        .then(() => (f as any).loading)
        .then(() => {
          if (f.mesh && 'isPickable' in f.mesh) f.mesh.isPickable = false
        })
        .catch(() => f.dispose()),
    )
  }
}
