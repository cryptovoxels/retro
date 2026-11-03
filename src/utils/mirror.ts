// Planar reflection of skybox, islands and parcel voxels. Render list is driven by mesh names.
export function mirrorTexture(scene: BABYLON.Scene, y: number): BABYLON.MirrorTexture {
  const tex = new BABYLON.MirrorTexture(`mirror_${y}`, 512, scene, true)
  tex.mirrorPlane = new BABYLON.Plane(0, -1, 0, y)
  tex.level = 0.4
  // Materials are assigned after mesh creation. Never sample the texture we're rendering into.
  tex.renderListPredicate = (m) => (m.name === 'skybox' || m.name.startsWith('island/') || m.name.startsWith('voxelizer/opaque-')) && !m.material?.hasTexture(tex)
  return tex
}
