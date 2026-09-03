import type { Mesh } from '@babylonjs/lite'
import earcut from 'earcut'
import { addCuboid } from '../physics/world'
import type { Lite } from './index'
import { loadTex } from './utils'

const Y = 0.74
const HALF_DEPTH = 16 // babylon extrudes 32 down, collider matches
const SHOW = 300

type Ring = [number, number][]

export async function liteIslands(lite: Lite) {
  const { L, engine, scene } = lite
  let data: any
  try {
    data = await (await fetch('/api/islands.json')).json()
  } catch (e) {
    return
  }
  const tex = await loadTex(lite, '/textures/00-grid.png')
  const far: Array<{ mesh: Mesh; x: number; z: number; r: number }> = []

  for (const desc of data.islands ?? []) {
    const rings: Ring[] = desc.id >= 40 ? desc.geometry.coordinates : [desc.geometry.coordinates[0]]
    let holes: Ring[] = desc.lakes_geometry_json?.coordinates?.map((p: Ring[]) => p[0]) ?? []
    if (desc.holes_geometry_json && ['Scarcity', 'Flora', 'Andromeda'].includes(desc.name)) holes = holes.concat(desc.holes_geometry_json.coordinates.map((p: Ring[]) => p[0]))

    const positions: number[] = []
    const indices: number[] = []
    let min = [Infinity, Infinity]
    let max = [-Infinity, -Infinity]
    rings.forEach((ring, i) => {
      const flat: number[] = []
      const holeIdx: number[] = []
      const push = (r: Ring, nudge: number) => r.forEach((c) => flat.push(c[0] * 100 + nudge, c[1] * 100 + nudge))
      push(ring, 0)
      // holes only cut the main polygon, same as babylon
      if (i === 0) for (const h of holes) (holeIdx.push(flat.length / 2), push(h, 0.25))
      const base = positions.length / 3
      for (let j = 0; j < flat.length; j += 2) {
        positions.push(flat[j], 0, flat[j + 1])
        min = [Math.min(min[0], flat[j]), Math.min(min[1], flat[j + 1])]
        max = [Math.max(max[0], flat[j]), Math.max(max[1], flat[j + 1])]
      }
      for (const k of earcut(flat, holeIdx)) indices.push(base + k)
    })
    if (!indices.length) continue

    const n = positions.length / 3
    const normals = new Float32Array(n * 3)
    const uvs = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      normals[i * 3 + 1] = 1
      uvs[i * 2] = positions[i * 3] - min[0]
      uvs[i * 2 + 1] = positions[i * 3 + 2] - min[1]
    }
    const mesh = L.createMeshFromData(engine, 'island/' + desc.name, new Float32Array(positions), normals, new Uint32Array(indices), uvs)
    const mat = L.createStandardMaterial()
    mat.diffuseColor = [0.05, 0.05, 0.05]
    mat.emissiveColor = [0.2, 0.2, 0.2]
    mat.specularColor = [0.2, 0.2, 0.2]
    mat.specularPower = 10
    mat.diffuseTexture = tex
    // grid every 0.5m like babylon's uScale = width * 2
    mat.uvScale = [2, 2]
    mat.uvOffset = [0.5, 0.5]
    mat.backFaceCulling = false
    mesh.material = mat
    mesh.position.set(0, Y, 0)
    L.addToScene(scene, mesh)

    const x = (min[0] + max[0]) / 2
    const z = (min[1] + max[1]) / 2
    addCuboid('island-' + desc.name, { x: (max[0] - min[0]) / 2, y: HALF_DEPTH, z: (max[1] - min[1]) / 2 }, { x, y: Y - HALF_DEPTH, z })
    far.push({ mesh, x, z, r: Math.hypot(max[0] - min[0], max[1] - min[1]) / 2 })
  }

  setInterval(() => {
    const p = lite.body.position
    for (const i of far) i.mesh.visible = Math.hypot(i.x - p.x, i.z - p.z) < SHOW + i.r
  }, 1000)
}
