import { IslandRecord, MultiPolygonGeometry } from '../../common/messages/api-islands'
import { StateObservable } from '../utils/state-observable'
import { createIslandMaterial } from '../materials'

export class Island {
  list: Islands
  desc: IslandRecord
  center: BABYLON.Vector3
  radius: number
  outline: BABYLON.Vector2[]
  texturePath = '/textures/ground.png'
  private readonly _mesh: BABYLON.Mesh

  constructor(list: Islands, desc: IslandRecord) {
    this.list = list
    this.desc = desc
    this.outline = this.desc.geometry.coordinates[0].map((c: [x: number, y: number]) => new BABYLON.Vector2(c[0] * 100, c[1] * 100)).reverse()

    if (window.config.isSpace) {
      this.texturePath = '/textures/subgrid.png'
    } else if (desc.texture) {
      // texture comes from the DB
      this.texturePath = desc.texture
    }

    // build mesh
    const shape = this.desc.geometry.coordinates[0].map((c) => new BABYLON.Vector2(c[0] * 100, c[1] * 100)).reverse()
    const pt = new BABYLON.PolygonMeshBuilder('island/' + this.name, shape, this.scene)

    // add holes for parcel basements and lakes
    const makeHoles = (multipolygon: MultiPolygonGeometry) => {
      const nudge = 0.25
      return multipolygon.coordinates.map((p) => p[0].map((c) => new BABYLON.Vector2(c[0] * 100 + nudge, c[1] * 100 + nudge)))
    }

    const holes = makeHoles(this.desc.lakes_geometry_json)
    if (this.desc.holes_geometry_json && this.hasBasements) {
      holes.push(...makeHoles(this.desc.holes_geometry_json))
    }

    holes.forEach((hole: BABYLON.Vector2[]) => {
      pt.addHole(hole)
    })

    const meshes = [pt.build(false, 32)]

    if (this.desc.id >= 40) {
      for (const s of this.desc.geometry.coordinates.slice(1)) {
        const shape = s.map((c) => new BABYLON.Vector2(c[0] * 100, c[1] * 100)).reverse()
        const pt = new BABYLON.PolygonMeshBuilder('island/' + this.name, shape, this.scene)
        meshes.push(pt.build(false, 32))
      }
    }

    const mesh = BABYLON.Mesh.MergeMeshes(meshes, true)!
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

  async render(parent: BABYLON.TransformNode): Promise<BABYLON.Mesh> {
    this._mesh.position.y = 0.75 - 0.01 // 0.01 = the nudge epsilon
    this._mesh.checkCollisions = true
    this._mesh.parent = parent

    const width = this._mesh.getBoundingInfo().maximum.x - this._mesh.getBoundingInfo().minimum.x
    const depth = this._mesh.getBoundingInfo().maximum.z - this._mesh.getBoundingInfo().minimum.z

    const texture = new BABYLON.Texture(this.texturePath, this.scene)

    // Configure texture UV scaling
    texture.vScale = depth * 2
    texture.uScale = width * 2
    texture.uOffset = 0.5
    texture.vOffset = 0.5

    this._mesh.material = createIslandMaterial(this.scene, {
      name: this.name,
      texture,
    })
    this._mesh.visibility = 1

    return this._mesh
  }
}

export default class Islands {
  scene: BABYLON.Scene
  parent: BABYLON.TransformNode
  islands: Island[] = []

  public islandsStateObservable = new StateObservable<'loaded' | 'unloaded'>('unloaded')
  private _fetchCompleted = false

  constructor(scene: BABYLON.Scene, parent: BABYLON.TransformNode) {
    this.scene = scene
    this.parent = parent
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

    await Promise.all(this.islands.map((i) => i.render(this.parent)))
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

  public invalidateIslandsLoaded() {
    this.islandsStateObservable.setState('unloaded')
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
}
