import { addToScene, createBox, createPlane, Mesh, SceneContext } from '@babylonjs/lite'

export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

export function featureBox(scene: SceneContext, name: string, size = 1): Mesh {
  const mesh = createBox(scene.surface.engine, { size })
  mesh.name = name
  addToScene(scene, mesh)
  return mesh
}

export function featurePlane(scene: SceneContext, name: string, size = 1): Mesh {
  const mesh = createPlane(scene.surface.engine, { size })
  mesh.name = name
  addToScene(scene, mesh)
  return mesh
}
