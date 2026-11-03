// Planar reflection of skybox, islands and parcel voxels. Render list is driven by mesh names.
export function mirrorTexture(scene: BABYLON.Scene, y: number): BABYLON.MirrorTexture {
  const tex = new BABYLON.MirrorTexture(`mirror_${y}`, 512, scene, true)
  tex.mirrorPlane = new BABYLON.Plane(0, -1, 0, y)
  tex.level = 0.4
  const list = tex.renderList!
  const observers = new Map<BABYLON.AbstractMesh, BABYLON.Observer<BABYLON.AbstractMesh>>()
  const update = (mesh: BABYLON.AbstractMesh) => {
    const index = list.indexOf(mesh)
    if (mesh.material?.hasTexture(tex)) {
      if (index !== -1) list.splice(index, 1)
    } else if (index === -1) list.push(mesh)
  }
  const add = (mesh: BABYLON.AbstractMesh) => {
    if (mesh.isDisposed() || observers.has(mesh)) return
    if (mesh.name !== 'skybox' && !mesh.name.startsWith('island/') && !mesh.name.startsWith('voxelizer/opaque-')) return
    observers.set(
      mesh,
      mesh.onMaterialChangedObservable.add(() => update(mesh)),
    )
    update(mesh)
  }
  const remove = (mesh: BABYLON.AbstractMesh) => {
    const observer = observers.get(mesh)
    if (!observer) return
    mesh.onMaterialChangedObservable.remove(observer)
    observers.delete(mesh)
    const index = list.indexOf(mesh)
    if (index !== -1) list.splice(index, 1)
  }
  for (const mesh of scene.meshes) add(mesh)
  const added = scene.onNewMeshAddedObservable.add(add)
  const removed = scene.onMeshRemovedObservable.add(remove)
  tex.onDisposeObservable.addOnce(() => {
    scene.onNewMeshAddedObservable.remove(added)
    scene.onMeshRemovedObservable.remove(removed)
    for (const [mesh, observer] of observers) mesh.onMaterialChangedObservable.remove(observer)
    observers.clear()
  })
  return tex
}
