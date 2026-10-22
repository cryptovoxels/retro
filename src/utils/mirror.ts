// Planar reflection of skybox, islands and parcel voxels. Render list is driven by mesh names.
export function mirrorTexture(scene: BABYLON.Scene, y: number): BABYLON.MirrorTexture {
  const tex = new BABYLON.MirrorTexture(`mirror_${y}`, 512, scene, true)
  tex.mirrorPlane = new BABYLON.Plane(0, -1, 0, y)
  tex.level = 0.4
  const wants = (m: BABYLON.AbstractMesh) => m.name === 'skybox' || m.name.startsWith('island/') || m.name.startsWith('voxelizer/opaque-')
  tex.renderList = scene.meshes.filter(wants)
  scene.onNewMeshAddedObservable.add((m) => {
    if (wants(m)) tex.renderList!.push(m)
  })
  scene.onMeshRemovedObservable.add((m) => {
    const i = tex.renderList!.indexOf(m)
    if (i !== -1) tex.renderList!.splice(i, 1)
  })
  return tex
}
