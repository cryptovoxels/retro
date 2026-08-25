import { physics } from './world'

let observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null
let mesh: BABYLON.LinesMesh | null = null
let lines: BABYLON.Vector3[][] = []
let colors: BABYLON.Color4[][] = []

function clear() {
  mesh?.dispose()
  mesh = null
  lines = []
  colors = []
}

function redraw(scene: BABYLON.Scene) {
  const w = physics()
  if (!w) return

  const { vertices, colors: rgba } = w.debugRender()
  const segs = vertices.length / 6
  if (segs === 0) {
    clear()
    return
  }

  if (segs !== lines.length) {
    clear()
    for (let i = 0; i < segs; i++) {
      const o = i * 6
      const c = i * 8
      lines.push([
        new BABYLON.Vector3(vertices[o], vertices[o + 1], vertices[o + 2]),
        new BABYLON.Vector3(vertices[o + 3], vertices[o + 4], vertices[o + 5]),
      ])
      colors.push([
        new BABYLON.Color4(rgba[c], rgba[c + 1], rgba[c + 2], rgba[c + 3]),
        new BABYLON.Color4(rgba[c + 4], rgba[c + 5], rgba[c + 6], rgba[c + 7]),
      ])
    }
    mesh = BABYLON.MeshBuilder.CreateLineSystem('physWires', { lines, colors, updatable: true }, scene)
    mesh.isPickable = false
    return
  }

  for (let i = 0; i < segs; i++) {
    const o = i * 6
    const c = i * 8
    const a = lines[i][0]
    const b = lines[i][1]
    a.x = vertices[o]
    a.y = vertices[o + 1]
    a.z = vertices[o + 2]
    b.x = vertices[o + 3]
    b.y = vertices[o + 4]
    b.z = vertices[o + 5]
    const ca = colors[i][0]
    const cb = colors[i][1]
    ca.r = rgba[c]
    ca.g = rgba[c + 1]
    ca.b = rgba[c + 2]
    ca.a = rgba[c + 3]
    cb.r = rgba[c + 4]
    cb.g = rgba[c + 5]
    cb.b = rgba[c + 6]
    cb.a = rgba[c + 7]
  }
  mesh = BABYLON.MeshBuilder.CreateLineSystem('physWires', { lines, colors, instance: mesh!, updatable: true }, scene)
}

export function toggleWires(scene: BABYLON.Scene) {
  if (observer) {
    scene.onBeforeRenderObservable.remove(observer)
    observer = null
    clear()
    return
  }
  observer = scene.onBeforeRenderObservable.add(() => redraw(scene))
}
