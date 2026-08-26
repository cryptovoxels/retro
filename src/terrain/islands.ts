import { IslandRecord } from '../../common/messages/api-islands'
import { StateObservable } from '../utils/state-observable'
import { pointInPolygon } from '../utils/polygon-utils'
import { addCuboid } from '../physics/world'
import { Camera, Mesh, SceneContext, Vec2, Vec3 } from '@babylonjs/lite'
import { vec3 } from 'wgpu-matrix'

function islandBounds(outline: Vec2[]) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of outline) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.y)
    maxZ = Math.max(maxZ, p.y)
  }
  const cx = (minX + maxX) * 0.5
  const cz = (minZ + maxZ) * 0.5
  const radius = Math.max(maxX - minX, maxZ - minZ) * 0.5
  return { cx, cz, radius, minX, maxX, minZ, maxZ }
}

function stubIslandMesh(bounds: ReturnType<typeof islandBounds>): Mesh {
  const center = vec3.fromValues(bounds.cx, 0, bounds.cz)
  const bb = {
    centerWorld: { clone: () => vec3.clone(center) },
    radiusWorld: bounds.radius,
    boundingBox: {
      center: { add: (p: any) => p },
      extendSize: { x: (bounds.maxX - bounds.minX) * 0.5, y: 0.5, z: (bounds.maxZ - bounds.minZ) * 0.5 },
    },
    minimum: { x: bounds.minX, z: bounds.minZ },
    maximum: { x: bounds.maxX, z: bounds.maxZ },
  }
  let enabled = false
  return {
    metadata: 'teleportable',
    receiveShadows: true,
    visibility: 0,
    material: null,
    position: { y: 0 },
    getBoundingInfo: () => bb,
    isEnabled: () => enabled,
    setEnabled: (v: boolean) => {
      enabled = v
    },
  } as Mesh
}

export class Island {
  list: Islands
  desc: IslandRecord
  center: Vec3
  radius: number
  outline: Vec2[]
  private readonly _mesh: Mesh

  constructor(list: Islands, desc: IslandRecord) {
    this.list = list
    this.desc = desc
    this.outline = this.desc.geometry.coordinates[0].map((c: [x: number, y: number]) => ({ x: c[0] * 100, y: c[1] * 100 } as Vec2)).reverse()

    // todo(lite): PolygonMeshBuilder island meshes
    const bounds = islandBounds(this.outline)
    this._mesh = stubIslandMesh(bounds)
    this.center = vec3.fromValues(bounds.cx, 0, bounds.cz)
    this.radius = bounds.radius
  }

  get name() {
    return this.desc.name
  }

  get mesh(): Mesh {
    return this._mesh
  }

  get scene() {
    return this.list.scene
  }

  get hasBasements() {
    return !!['Scarcity', 'Flora', 'Andromeda'].includes(this.name)
  }

  checkIntersects(_boundingInfo: any) {
    return false
  }

  async render(): Promise<Mesh> {
    this._mesh.position.y = 0.75 - 0.01
    this._mesh.visibility = 1

    const bb = this._mesh.getBoundingInfo().boundingBox
    addCuboid(
      `island-${this.name}`,
      { x: bb.extendSize.x, y: bb.extendSize.y, z: bb.extendSize.z },
      { x: this.center[0], y: this._mesh.position.y, z: this.center[2] },
    )

    return this._mesh
  }
}

export default class Islands {
  scene: SceneContext
  islands: Island[] = []

  public islandsStateObservable = new StateObservable<'loaded' | 'unloaded'>('unloaded')
  private _fetchCompleted = false

  constructor(scene: SceneContext) {
    this.scene = scene
  }

  async load(): Promise<void> {
    const s = document.querySelector('script#islands')
    if (s) {
      this.islands = JSON.parse(s.innerHTML).map((i: IslandRecord) => new Island(this, i))
    } else {
      const response = await fetch('/api/islands.json')
      const data = await response.json()
      this.islands = data.islands.map((i: IslandRecord) => new Island(this, i))
    }

    await Promise.all(this.islands.map((i) => i.render()))
    this._fetchCompleted = true // Wait until setVisibility() to notify observers
  }

  // this should be called regularly to enable/disable rendering of islands that are far away
  setVisibility(cam: Camera, loadingDistance: number) {
    const camPos = cam.position.clone()
    // we ignore the height of the camera, so that islands are rendered even if the camera is above or below them
    camPos.y = 0
    this.islands.forEach((i) => {
      // hasn't been rendered / loaded
      if (!i.center || !i.mesh) {
        return
      }
      const a = i.radius + loadingDistance
      // this such a bad distance calculations since a circle doesn't fit rectangular islands very well,
      // but it is a hella lot better than trying to draw every island in the world from origin
      const isVisible = camPos.subtract(i.center).lengthSquared() < a * a
      if (i.mesh.isEnabled() !== isVisible) {
        i.mesh.setEnabled(isVisible)
      }
    })

    if (this._fetchCompleted) {
      this.islandsStateObservable.setState('loaded') // No-op if already in this state
    }
  }

  public invalidateIslandsLoaded() {
    this.islandsStateObservable.setState('unloaded')
  }

  getIntersecting(boundingInfo: any) {
    return this.islands.filter((island) => {
      return island.hasBasements && island.checkIntersects(boundingInfo)
    })
  }

  allMeshes(): Mesh[] {
    const meshes: Mesh[] = []
    for (const island of this.islands) {
      if (island.mesh) {
        meshes.push(island.mesh)
      } else {
        console.warn('island has no mesh', island.name)
      }
    }
    return meshes
  }

  getIslandData(): IslandRecord[] {
    return this.islands.map((island) => island.desc)
  }

  getIsland(point: Vec2): Island | false {
    for (const island of this.islands) {
      const dx = point.x - island.center.x
      const dz = point.y - island.center.z
      if (dx * dx + dz * dz > island.radius * island.radius) continue
      const polygon = island.outline.map((v) => ({ x: v.x, z: v.y }))
      if (pointInPolygon({ x: point.x, z: point.y }, polygon)) return island
    }
    return false
  }
}
