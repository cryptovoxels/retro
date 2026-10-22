import { IslandRecord } from '../../common/messages/api-islands'
import { StateObservable } from '../utils/state-observable'
import { createIslandMaterial } from '../materials'
import { pointInPolygon, snapRing } from '../utils/polygon-utils'
import { addTrimesh, removeCollider } from '../physics/world'

export class Island {
  list: Islands
  desc: IslandRecord
  center: BABYLON.Vector3
  radius: number
  outline: BABYLON.Vector2[]
  texturePath = '/textures/00-grid.png'
  private readonly _mesh: BABYLON.Mesh

  constructor(list: Islands, desc: IslandRecord) {
    this.list = list
    this.desc = desc
    this.outline = snapRing(this.desc.geometry.coordinates[0])
      .map((p) => new BABYLON.Vector2(p.x, p.z))
      .reverse()

    const holes = [this.desc.lakes_geometry_json, this.hasBasements ? this.desc.holes_geometry_json : null]
      .flatMap((geometry) => geometry?.coordinates || [])
      .map((polygon) => snapRing(polygon[0]).map((p) => new BABYLON.Vector2(p.x, p.z)))
      .filter((hole) => hole.length >= 3)
    const rings = this.desc.id >= 40 ? this.desc.geometry.coordinates : [this.desc.geometry.coordinates[0]]
    const meshes = rings.map((ring, index) => {
      const shape = snapRing(ring)
        .map((p) => new BABYLON.Vector2(p.x, p.z))
        .reverse()
      if (shape.length < 3) return new BABYLON.Mesh('island/' + this.name, this.scene)
      const builder = new BABYLON.PolygonMeshBuilder('island/' + this.name, shape, this.scene)
      if (index === 0) holes.forEach((hole) => builder.addHole(hole))
      return builder.build(false, 32)
    })

    const mesh = BABYLON.Mesh.MergeMeshes(meshes, true)!
    mesh.position.y = 0.74
    const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)!
    const normals = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind)!
    const uvs: number[] = []
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]
      const y = positions[i + 1] + mesh.position.y
      const z = positions[i + 2]
      const horizontal = Math.abs(normals[i + 1]) > 0.5
      // Two repeats per metre on every face, including basement and lake walls.
      uvs.push((horizontal ? x : x * normals[i + 2] - z * normals[i]) * 2, (horizontal ? z : y) * 2)
    }
    mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs)
    mesh.metadata = 'teleportable'
    mesh.receiveShadows = true
    mesh.visibility = 0

    this._mesh = mesh

    // such a bad fit for distance checking, but so fast to check
    // Note that these are in world-coordinates
    this.center = this._mesh.getBoundingInfo().boundingSphere.centerWorld.clone()
    this.radius = this._mesh.getBoundingInfo().boundingSphere.radiusWorld
  }

  get name() {
    return this.desc.name
  }

  get mesh(): BABYLON.Mesh {
    return this._mesh
  }

  get scene() {
    return this.list.scene
  }

  get hasBasements() {
    return !!['Scarcity', 'Flora', 'Andromeda'].includes(this.name)
  }

  checkIntersects(boundingInfo: BABYLON.BoundingInfo) {
    if (!this._mesh) {
      console.warn('no mesh for island, cannot check for intersection. Possible race condition detected', this.name)
      return false
    }
    return BABYLON.BoundingBox.Intersects(this._mesh.getBoundingInfo().boundingBox as BABYLON.DeepImmutableObject<BABYLON.BoundingBox>, boundingInfo.boundingBox as BABYLON.DeepImmutableObject<BABYLON.BoundingBox>)
  }

  async render(): Promise<BABYLON.Mesh> {
    const texture = new BABYLON.Texture(this.texturePath, this.scene)
    texture.uOffset = texture.vOffset = 0.5

    this._mesh.material = createIslandMaterial(this.scene, {
      name: this.name,
      texture,
    })
    this._mesh.visibility = 1

    // Use the rendered geometry so basement and lake holes stay open.
    addTrimesh(`island-${this.name}`, new Float32Array(this._mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)!), new Uint32Array(this._mesh.getIndices()!), this._mesh.position)

    return this._mesh
  }
}

export default class Islands {
  scene: BABYLON.Scene
  islands: Island[] = []

  public islandsStateObservable = new StateObservable<'loaded' | 'unloaded'>('unloaded')
  private _fetchCompleted = false

  constructor(scene: BABYLON.Scene) {
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
  setVisibility(cam: BABYLON.Camera, loadingDistance: number) {
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

  // island designer preview: drop a polygon in after load, or pull it back out
  async add(desc: IslandRecord) {
    this.remove(desc.name)
    const island = new Island(this, desc)
    this.islands.push(island)
    await island.render()
    return island
  }

  remove(name: string) {
    const i = this.islands.findIndex((i) => i.name === name)
    if (i < 0) return
    removeCollider(`island-${name}`)
    this.islands[i].mesh.dispose()
    this.islands.splice(i, 1)
  }

  getIntersecting(boundingInfo: BABYLON.BoundingInfo) {
    return this.islands.filter((island) => {
      return island.hasBasements && island.checkIntersects(boundingInfo)
    })
  }

  allMeshes(): BABYLON.Mesh[] {
    const meshes: BABYLON.Mesh[] = []
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

  getIsland(point: BABYLON.Vector2): Island | false {
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
