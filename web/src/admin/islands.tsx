import { Component, createRef, Fragment } from 'preact'
import { ParcelMetaCodec, type ParcelMeta } from '../../../common/types'
import ndarray, { NdArray } from 'ndarray'
import * as t from 'io-ts'
import { ethers } from 'ethers'
import { contours } from 'd3-contour'

const L = window.L as typeof window.L

const PAVEMENT_LEVEL = 1
const BLEED_MARGIN = 2

// Fixme cant import from the src bundle
import aoMeshVertexShader from '../../../src/shaders/ao-mesh.vsh'
BABYLON.Effect.ShadersStore['aoMeshVertexShader'] = aoMeshVertexShader

import aoMeshPixelShader from '../../../src/shaders/ao-mesh.fsh'
BABYLON.Effect.ShadersStore['aoMeshPixelShader'] = aoMeshPixelShader

// Mesher
import mesher from '../../../common/voxels/mesher'
import { defaultColors } from '../../../common/content/blocks'
import { getVoxelsFromBuffer } from '../../../common/voxels/helpers'
import PARCEL_CONTRACT_ABI from '../../../common/contracts/parcel.json'
import { debounce } from 'lodash'
import { app } from '../state'

export const voxelShader = (scene: BABYLON.Scene, name: string) => {
  // need uniforms for brightness, ambient, lightDirection, fogDensity, fogColor
  const m = new BABYLON.ShaderMaterial(
    `voxel-field/${name}`,
    scene,
    { vertex: 'aoMesh', fragment: 'aoMesh' },
    {
      attributes: ['position', 'normal', 'block', 'ambientOcclusion'],
      uniforms: ['worldViewProjection', 'tileSize', 'tileCount', 'brightness', 'ambient', 'lightDirection', 'fogDensity', 'fogColor', 'palette'],
      samplers: ['tileMap'],
      defines: ['#define IMAGEPROCESSINGPOSTPROCESS'],
    },
  )
  m.setTexture('tileMap', new BABYLON.Texture('/textures/atlas-ao.png', scene, false, false))
  m.setFloat('tileSize', 128)
  m.setFloat('tileCount', 4.0)
  m.setColor3Array(
    'palette',
    defaultColors.map((c) => BABYLON.Color3.FromHexString(c)),
  )
  m.blockDirtyMechanism = true
  m.setFloat('brightness', 1.5)
  m.setFloat('ambient', 0.5)
  m.setVector3('lightDirection', new BABYLON.Vector3(0, 1, 0))
  m.setFloat('fogDensity', 0.00001)
  m.setColor3('fogColor', new BABYLON.Color3(0.3, 0.35, 0.8))
  // scene.environment?.setShaderParameters(m, 1.5)
  return m
}

function getIslandGeometry(field: IslandField, center: vec2) {
  // Convert island field to a row-major flat array
  const grid = []

  // console.log(field)

  const height = field.shape[2]
  const width = field.shape[0]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid.push(field.get(x, PAVEMENT_LEVEL, y))
    }
  }

  // console.log(grid.length)
  // console.log(grid.filter((i) => i === 0).length)

  const granularize = (v: number) => Math.floor(v * 100) / 10000

  // d3-contour wants a flat array of numbers (row-major)
  const values = grid.flat()

  // console.log(values)

  // One binary threshold at 0.5 → outlines the 1s region(s)
  const cs = contours().size([width, height]).thresholds([0.5])(values) // returns an array; we used a single threshold

  // const bleedOffset = BLEED_MARGIN / 100

  // console.log(center)
  // console.log(width, height)

  const offsetX = center[0] - width / 200
  const offsetY = center[1] - height / 200

  // console.log('offsetX', offsetX, 'offsetY', offsetY)

  const geojson = {
    type: 'Polygon',
    coordinates: cs[0].coordinates.map((ring: any) => ring[0].map(([x, y]: any) => [granularize(x) + offsetX, granularize(y) + offsetY])),
  }

  // usage
  // const geometry = toIslandsMultiPolygon(cs)
  // // FeatureCollection if you want:
  // const geojson = {
  //   type: 'FeatureCollection',
  //   features: [{ type: 'Feature', properties: { threshold: 0.5 }, geometry }],
  // }

  // // If you want to scale to world units (e.g., each pixel = 0.25m), multiply coords:
  // const scale = 1.0 // change if you want
  // if (scale !== 1) {
  //   for (const f of geojson.features) {
  //     f.geometry.coordinates = f.geometry.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [granularize(x * scale), granularize(y * scale)])))
  //   }
  // }

  return geojson
}

type vec2 = [number, number]
type vec4 = [number, number, number, number]
export interface Props {
  id?: string
}

type ProspectiveParcel = ParcelMeta & {
  mesh?: BABYLON.Mesh
}

export interface State {
  parcels: ProspectiveParcel[]
  start: number
  w: number
  h: number
  d: number
  name: string
  center: vec2
}

export default class IslandsAdmin extends Component<Props, State> {
  private canvas = createRef<HTMLCanvasElement>()
  private engine: BABYLON.Engine | null = null
  private islandMesh: BABYLON.Mesh | null = null
  map: L.Map | undefined
  mapRef = createRef<HTMLDivElement>()
  parcelLayer: L.LayerGroup | undefined

  constructor(props: Props) {
    super(props)

    this.state = {
      parcels: defaultParcels,
      start: 1,
      w: 8,
      h: 6,
      d: 8,
      name: 'New Island',
      center: [11.14, -5.61],
    }
  }

  componentDidMount() {
    this.createScene()
    this.regenerate()
    this.fetch()
  }

  async fetch() {
    const response = await fetch(`/api/admin/parcels/top?nonce=${Math.random()}`)
    const { id } = await response.json()
    this.setState({ start: id })

    setTimeout(() => this.regenerate(), 100)
  }

  private createScene() {
    const canvas = this.canvas.current
    if (!canvas) return

    const engine = new BABYLON.Engine(canvas, true)
    this.engine = engine

    const scene = new BABYLON.Scene(engine)
    scene.clearColor = new BABYLON.Color4(0.3, 0.35, 0.8, 1)

    const camera = new BABYLON.ArcRotateCamera('orthoCamera', -Math.PI / 2, Math.PI / 4, 128, BABYLON.Vector3.Zero(), scene)
    camera.setTarget(BABYLON.Vector3.Zero())
    camera.attachControl(canvas, true)

    const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene)

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 256, height: 256, subdivisions: 256 }, scene)
    ground.position.set(-0.5, 0, -0.5)
    const gridMat = new BABYLON.GridMaterial('grid', scene)
    gridMat.gridRatio = 4
    gridMat.mainColor = new BABYLON.Color3(0.5, 0.5, 1)
    gridMat.lineColor = new BABYLON.Color3(0.5, 0.5, 0.75)
    gridMat.opacity = 0.8
    ground.material = gridMat
    ground.isPickable = true

    // const cubes = new Map<string, BABYLON.Mesh>()

    const snap = (v: number) => Math.round(v / 4) * 4

    const pointerDownHandler = (evt: PointerEvent, info: BABYLON.PointerInfo) => {
      if (info.pickInfo && info.pickInfo.pickedPoint) {
        const { x, z } = info.pickInfo.pickedPoint
        const posX = snap(x)
        const posZ = snap(z)

        if (evt.button === 2) {
          console.log('right click')
          console.log(info.pickInfo)

          const mesh = info.pickInfo.pickedMesh

          if (mesh) {
            if (mesh.name.startsWith('parcel')) {
              mesh.dispose()
              this.setState({ parcels: this.state.parcels.filter((p) => p.mesh !== mesh) })
            }
          }

          setTimeout(() => this.regenerate(), 100)
          // Right click - remove cube
          // const mesh = cubes.get(key)
          // if (mesh) {
          //   mesh.dispose()
          //   cubes.delete(key)
          // }
        } else if (evt.shiftKey) {
          // Left click - add cube
          // if (!cubes.has(key)) {

          // if (this.state.w % 2 === 0) {
          //   posX += 0.5
          // }

          // if (this.state.d % 2 === 0) {
          //   posZ += 0.5
          // }

          const height = Math.max(4, this.state.h + Math.floor(Math.random() * 8))

          const parcel = {
            x1: posX - this.state.w / 2,
            y1: 0,
            z1: posZ - this.state.d / 2,
            x2: posX + this.state.w / 2,
            y2: height,
            z2: posZ + this.state.d / 2,
            id: this.state.parcels.length + 1,
          }

          const parcels = [...this.state.parcels, parcel]
          this.setState({ parcels })
          // cubes.set(key, box)
          // }

          setTimeout(() => this.regenerate())
        }
      }
    }

    scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        pointerDownHandler(pointerInfo.event as PointerEvent, pointerInfo)
      }
    })

    // Disable right-click context menu on canvas
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    engine.runRenderLoop(() => {
      scene.render()
    })

    window.addEventListener('resize', () => {
      engine.resize()
    })
  }

  get scene() {
    return this.engine?.scenes[0]
  }

  generateIsland = () => {
    this.islandMesh?.dispose()

    if (this.state.parcels.length === 0) {
      return
    }

    const { bounds, field } = getIslandField(this.state.parcels)
    this.islandMesh = getIslandMesh(field, this.scene!)
    // console.log(bounds)

    this.islandMesh.position.set(bounds[0], -2, bounds[1])
    this.islandMesh.isPickable = false

    this.generateParcelLayer(field, bounds)
  }

  componentWillUnmount(): void {
    this.engine?.dispose()
  }

  download = () => {
    const json = JSON.stringify({ parcels: this.state.parcels.map((p) => ({ ...p, mesh: undefined })) })
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'islands.json'
    a.click()
  }

  upload = async (e: any) => {
    const file = e.target.files[0]
    const text = await file.text()
    console.log(text)

    const { parcels } = JSON.parse(text)

    // Use
    this.setState({ parcels })

    setTimeout(() => this.regenerate(), 100)
  }

  generateParcelLayer(field: IslandField, bounds: vec4) {
    this.parcelLayer?.clearLayers()

    // const [minX, minZ] = this.state.center
    const [w, h] = field.shape
    const scale = 0.01

    // Add island geometry
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < h; z++) {
        if (field.get(x, z) === 1) {
          const worldX = this.state.center[0] + (x + bounds[0]) * scale
          const worldZ = this.state.center[1] + (z + bounds[1]) * scale

          const [lat1, lng1] = [worldZ, worldX]
          const [lat2, lng2] = [worldZ + scale, worldX + scale]

          const latlngs: L.LatLngBoundsExpression = [
            [lat1, lng1],
            [lat2, lng2],
          ]

          // console.log(bounds)

          const rect = L.rectangle(latlngs, {
            color: '#eee',
            fillOpacity: 0.8,
          })

          this.parcelLayer?.addLayer(rect)
        }
      }
    }

    // Add parcels
    for (const p of this.state.parcels) {
      // const [w, h, d] = [p.x2 - p.x1, p.y2 - p.y1, p.z2 - p.z1]

      const [lat1, lng1] = [p.z1 * scale + this.state.center[1], p.x1 * scale + this.state.center[0]]
      const [lat2, lng2] = [p.z2 * scale + this.state.center[1], p.x2 * scale + this.state.center[0]]

      const latlngs: L.LatLngBoundsExpression = [
        [lat1, lng1],
        [lat2, lng2],
      ]

      console.log(lat1, lng1, lat2, lng2)

      const rect = L.rectangle(latlngs, {
        color: '#f0f',
        weight: 1,
        noClip: true,
        fillOpacity: 1,
      })

      this.parcelLayer?.addLayer(rect)
    }

    // Add label

    const label = L.marker([this.state.center[1], this.state.center[0]], {
      icon: L.divIcon({
        className: 'island-label',
        html: `<span>${this.state.name}</span>`,
        iconSize: [100, 20],
        iconAnchor: [50, 10],
      }),
    })
    console.log(label.getLatLng())
    this.parcelLayer?.addLayer(label)

    // Add island geometry

    const geojson = this.getIslandGeometry() as any
    console.log(JSON.stringify(geojson))

    const island = L.geoJSON(geojson, {
      style: {
        fillColor: '#fff',
        color: '#f0f',
        weight: 1,
        fillOpacity: 0.5,
      },
    })
    this.parcelLayer?.addLayer(island)
  }

  regenerate() {
    const parcels = this.state.parcels.slice()

    let index = 1
    for (const p of parcels) {
      p.id = index++ + this.state.start
      p.mesh?.dispose()

      const box = BABYLON.MeshBuilder.CreateBox('parcel', { size: 1 }, this.scene!)
      box.position.y = 0.5
      box.bakeCurrentTransformIntoVertices()

      const w = p.x2 - p.x1
      const h = p.y2 - p.y1
      const d = p.z2 - p.z1

      box.scaling.set(w, h, d)
      box.position.set(p.x1 + w / 2, 0, p.z1 + d / 2)
      box.isPickable = true

      if (w % 2 === 0) {
        box.position.x -= 0.5
      }

      if (d % 2 === 0) {
        box.position.z -= 0.5
      }

      const cubeMaterial = new BABYLON.StandardMaterial('cubeMat', this.scene!)
      cubeMaterial.diffuseColor = new BABYLON.Color3(1, 0, 0.5)

      const dynamicTexture = new BABYLON.DynamicTexture('dynamic texture', { width: 256, height: 256 }, this.scene!, false)
      const ctx = dynamicTexture.getContext()
      const grad = ctx.createLinearGradient(0, 0, 0, 256)
      grad.addColorStop(0, '#f0a')
      grad.addColorStop(1, '#a07')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 256, 256)
      dynamicTexture.drawText(String(p.id), 64, 128, 'bold 64px Arial', 'white', null, true)
      dynamicTexture.update()
      cubeMaterial.diffuseTexture = dynamicTexture
      cubeMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1)
      cubeMaterial.specularColor = new BABYLON.Color3(0, 0, 0)
      cubeMaterial.backFaceCulling = false

      box.material = cubeMaterial

      p.mesh = box
    }

    this.setState({ parcels })

    this.center()
    this.generateIsland()
  }

  center() {
    if (!this.mapRef.current) {
      return
    }

    if (!this.map) {
      const world = L.tileLayer(`${process.env.MAP_URL}/tile?z={z}&x={x}&y={y}`, {
        minZoom: 3,
        maxZoom: 20,
        attribution: 'Map data &copy; Voxels',
        id: 'Voxels',
      })

      this.map = L.map(this.mapRef.current, { layers: [world], preferCanvas: true }) as L.Map

      // On click, set center

      this.map.on('click', (e) => {
        this.setState({ center: [e.latlng.lng, e.latlng.lat] })
        setTimeout(() => this.regenerate(), 100)
      })

      this.parcelLayer = L.layerGroup().addTo(this.map)

      this.map.setView([this.state.center[1], this.state.center[0]], 8)
    }

    // let marker = L.marker([this.state.center[1], this.state.center[0]], {
    //   icon: L.icon({
    //     iconUrl: '/assets/marker.png',
    //     iconSize: [32, 32],
    //     iconAnchor: [16, 32],
    //   }),
    // })

    // this.map.addLayer(marker)
  }

  async create(parcel: ProspectiveParcel) {
    const id = parcel.id

    const number = parcel.id - this.state.start
    const address = `${number} ${this.state.name}`

    const scale = 0.01
    const x1 = parcel.x1 * scale + this.state.center[0]
    const y1 = parcel.y1
    const z1 = parcel.z1 * scale + this.state.center[1]
    const x2 = parcel.x2 * scale + this.state.center[0]
    const y2 = parcel.y2
    const z2 = parcel.z2 * scale + this.state.center[1]

    const island = this.state.name
    const owner = app.state.wallet || '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'

    const response = await fetch('/api/admin/parcels/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id,
        address,
        island,
        owner,
        x1,
        y1,
        z1,
        x2,
        y2,
        z2,
      }),
    })
  }

  async mint(parcel: ProspectiveParcel) {
    console.log(parcel)

    const id = parcel.id + this.state.start
    // const address = `Pink ${parcel.id}`

    /*
    const response = await fetch('/api/admin/parcels/create', {
      method: 'POST',
      body: JSON.stringify({
        id,
        address,
        x1: parcel.x1,
        y1: parcel.y1,
        z1: parcel.z1,
        x2: parcel.x2,
        y2: parcel.y2,
        z2: parcel.z2,
      }),
    })
    */

    /*

    {
      "constant": false,
      "inputs": [
        {
          "name": "_to",
          "type": "address"
        },
        {
          "name": "_tokenId",
          "type": "uint256"
        },
        {
          "name": "x1",
          "type": "int16"
        },
        {
          "name": "y1",
          "type": "int16"
        },
        {
          "name": "z1",
          "type": "int16"
        },
        {
          "name": "x2",
          "type": "int16"
        },
        {
          "name": "y2",
          "type": "int16"
        },
        {
          "name": "z2",
          "type": "int16"
        },
        {
          "name": "_price",
          "type": "uint256"
        }
      ],
      "name": "mint",
      "outputs": [],
      "payable": false,
      "stateMutability": "nonpayable",
      "type": "function"
    },
    */

    try {
      const provider = new ethers.BrowserProvider(window.ethereum as any)
      const signer = await provider.getSigner()

      const contract = new ethers.Contract('0x79986aF15539de2db9A5086382daEdA917A9CF0C', PARCEL_CONTRACT_ABI.abi, signer)

      const owner = '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'
      const tx = await contract.mint(owner, id, parcel.x1, parcel.y1, parcel.z1, parcel.x2, parcel.y2, parcel.z2, ethers.parseEther('0'))

      console.log('Transaction submitted:', tx.hash)

      await tx.wait()
      console.log('Transaction confirmed')
    } catch (err) {
      console.error('On-chain minting failed:', err)
    }
  }

  onSave = async (e: any) => {
    e.preventDefault()

    const { parcels, name } = this.state
    var { field } = getIslandField(parcels)
    const voxels = getVoxelsFromBuffer(field.data)
    const content = { voxels }

    // Generate WKT
    // const w = 0.5
    // const h = 0.5
    // const x1 = this.state.center[0] - w / 2
    // const y1 = this.state.center[1] - h / 2
    // const x2 = this.state.center[0] + w / 2
    // const y2 = this.state.center[1] + h / 2

    // const geometry = `POLYGON((${x1} ${y1}, ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2}, ${x1} ${y1}))`
    const geometry = this.getIslandGeometry()

    console.log(JSON.stringify(geometry, null, 2))
    await fetch('/api/admin/islands', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, geometry, content }),
    })
  }

  private getIslandGeometry() {
    var { bounds, field } = getIslandField(this.state.parcels, true)

    const scale = 0.01
    const [x1, y1, x2, y2] = bounds.map((b) => b * scale)

    console.log('x1', x1, 'y1', y1, 'x2', x2, 'y2', y2)
    console.log('center', this.state.center)

    // Construct island center from center of bounds + this.state.center
    const center: vec2 = [0, 0]
    center[0] = this.state.center[0] + (x1 + x2) / 2
    center[1] = this.state.center[1] + (y1 + y2) / 2

    return getIslandGeometry(field, center)
  }

  onName = (e: any) => {
    this.setState({ name: e.target.value })

    this.regenerateIsland()
  }

  regenerateIsland = debounce(this.generateIsland, 100)

  render() {
    const center = this.state.center.map((c) => c.toFixed(2)).join(',')
    return (
      <section class="columns">
        <h1>{this.state.name ? this.state.name : 'Island Builder'}</h1>

        <article>
          <figure>
            <canvas id="islands-canvas" ref={this.canvas} />
          </figure>
        </article>
        <aside>
          <form>
            <div class="f">
              <label>Name</label>
              <input type="text" value={this.state.name} onChange={this.onName} />
            </div>

            <div class="f">
              <label>Center</label>
              <input type="text" value={center} onChange={(e: any) => this.setState({ center: e.target.value.split(',').map(Number) })} />
              <div class="island-map" ref={this.mapRef} />
            </div>

            <button onClick={this.onSave}>Save</button>

            <select
              value={this.state.w + ',' + this.state.h + ',' + this.state.d}
              onChange={(e: any) => {
                const [w, h, d] = e.target.value.split(',').map(Number)
                this.setState({ w, h, d })
              }}
            >
              {sizes.map((size) => (
                <option value={size.join(',')}>{size.join('x')}</option>
              ))}
            </select>
          </form>
          <h3>Parcels</h3>

          <button onClick={this.download}>Download</button>
          <input type="file" accept=".json" onChange={this.upload} />

          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Position</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {this.state.parcels.map((parcel) => {
                const minted = false

                return (
                  <tr key={parcel.id}>
                    <td>
                      <a href={`/parcels/${parcel.id}`}>{parcel.id}</a>
                    </td>
                    <td>{`${parcel.x1},${parcel.y1},${parcel.z1}`}</td>
                    <td>{`${parcel.x2 - parcel.x1},${parcel.y2 - parcel.y1},${parcel.z2 - parcel.z1}`}</td>
                    <td>{minted ? <button onClick={() => this.mint(parcel)}>Mint</button> : <button onClick={() => this.create(parcel)}>Create</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </aside>
      </section>
    )
  }
}

// Helpers

/*
  cryptovoxels=# SELECT
  ROUND((ST_XMax(geometry) - ST_XMin(geometry)) * 100) AS width_cm,
  ROUND((ST_YMax(geometry) - ST_YMin(geometry)) * 100) AS depth_cm,
  ROUND((y2 - y1)) AS height_cm,
  COUNT(*) AS count
FROM properties
GROUP BY width_cm, depth_cm, height_cm
ORDER BY count DESC
LIMIT 20;

*/

const sizes = [
  [24, 20, 12],
  [32, 20, 12],
  [20, 28, 16],
  [12, 12, 12],
  [16, 12, 16],
  [8, 8, 8],
  [22, 28, 12],
  [20, 24, 16],
  [24, 24, 16],
  [4, 12, 32],
].sort((a, b) => b[0] * b[1] * b[2] - a[0] * a[1] * a[2])

const defaultParcels = [
  { x1: 20, y1: 0, z1: 8, x2: 28, y2: 10, z2: 16, id: 9112 },
  { x1: 20, y1: 0, z1: -4, x2: 28, y2: 8, z2: 4, id: 9113 },
  { x1: 20, y1: 0, z1: 32, x2: 28, y2: 13, z2: 40, id: 9114 },
  { x1: 20, y1: 0, z1: 20, x2: 28, y2: 9, z2: 28, id: 9115 },
  { x1: 20, y1: 0, z1: -24, x2: 28, y2: 15, z2: -16, id: 9116 },
  { x1: 36, y1: 0, z1: 20, x2: 44, y2: 10, z2: 28, id: 9117 },
  { x1: 48, y1: 0, z1: 20, x2: 56, y2: 14, z2: 28, id: 9118 },
  { x1: 60, y1: 0, z1: 20, x2: 68, y2: 14, z2: 28, id: 9119 },
  { x1: 34, y1: 0, z1: -2, x2: 46, y2: 19, z2: 10, id: 9120 },
  { x1: 30, y1: 0, z1: -18, x2: 42, y2: 15, z2: -6, id: 9121 },
  { x1: 20, y1: 0, z1: 48, x2: 28, y2: 15, z2: 56, id: 9122 },
]

type IslandField = NdArray<Uint16Array>

export function getIslandField(parcels: ProspectiveParcel[], hull = false): { bounds: vec4; field: IslandField } {
  if (parcels.length === 0) {
    throw new Error('No parcels provided')
  }

  const margin = BLEED_MARGIN
  // const splatMargin = 4

  let minX = Infinity,
    maxX = -Infinity
  let minZ = Infinity,
    maxZ = -Infinity

  for (const p of parcels) {
    minX = Math.min(minX, p.x1)
    maxX = Math.max(maxX, p.x2)
    minZ = Math.min(minZ, p.z1)
    maxZ = Math.max(maxZ, p.z2)
  }

  // Grow bounds by 1 unit in all directions
  minX -= 1 + margin
  maxX += 1 + margin
  minZ -= 1 + margin
  maxZ += 1 + margin

  const bounds: vec4 = [minX, minZ, maxX, maxZ]

  const w = maxX - minX
  const h = 4
  const d = maxZ - minZ

  const solid = (1 << 15) + 0
  const border = (1 << 15) + 4

  const field = ndarray(new Uint16Array(w * h * d), [w, h, d])

  // console.log(minX, maxX, minZ, maxZ)
  // console.log(w, h)

  function occupied(x: number, z: number) {
    for (const p of parcels) {
      if (minX + x >= p.x1 && minX + x < p.x2 && minZ + z >= p.z1 && minZ + z < p.z2) {
        return true
      }
    }

    return false
  }

  function splat(x: number, z: number, radius: number, value: number) {
    for (let i = -radius; i <= radius; i++) {
      for (let j = -radius; j <= radius; j++) {
        field.set(x + i, PAVEMENT_LEVEL, z + j, value)
      }
    }
  }
  // Bleed out parcels
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (occupied(x, z)) {
        splat(x, z, margin, solid)
      }
    }
  }

  // Parcel border (minisplat)
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (occupied(x, z)) {
        splat(x, z, 1, border)
      }
    }
  }

  // Flood fill from edges
  const queue: [number, number][] = []

  // Push corners
  queue.push([0, 0], [0, h - 1], [w - 1, 0], [w - 1, h - 1])

  while (queue.length > 0) {
    const [x, z] = queue.shift()!
    if (x < 0 || x >= w || z < 0 || z >= d) continue
    if (field.get(x, PAVEMENT_LEVEL, z) !== 0) continue

    field.set(x, PAVEMENT_LEVEL, z, 2) // mark as water-accessible

    queue.push([x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1])
  }

  // All remaining 0s are enclosed: mark them as ground (1)
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (field.get(x, PAVEMENT_LEVEL, z) === 0) {
        field.set(x, PAVEMENT_LEVEL, z, solid)
      }
    }
  }

  // Null out parcels
  if (!hull) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        if (occupied(x, z)) {
          field.set(x, PAVEMENT_LEVEL, z, 0)
        }
      }
    }
  }

  // Delete the ocean
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (field.get(x, PAVEMENT_LEVEL, z) === 2) {
        field.set(x, PAVEMENT_LEVEL, z, 0)
      }
    }
  }

  return { bounds, field }
}

function getIslandMesh(field: IslandField, scene: BABYLON.Scene) {
  const meshData = mesher(field.shape as any, field)

  var normals: number[] = []
  BABYLON.VertexData.ComputeNormals(meshData.opaquePositions, meshData.opaqueIndices, normals)

  const vertData = new BABYLON.VertexData()
  vertData.normals = normals
  vertData.positions = meshData.opaquePositions
  vertData.indices = meshData.opaqueIndices
  // vertData.uvs = computeUVs(meshData.opaquePositions, normals)

  const mesh = new BABYLON.Mesh('island', scene)
  mesh.setVerticesData('position', meshData.opaquePositions)
  mesh.setVerticesData('normal', normals)
  mesh.setVerticesData('block', new Float32Array(meshData.opaqueTextureIndices), false, 1)
  mesh.setVerticesData('ambientOcclusion', new Float32Array(meshData.ambientOcclusion), false, 1)
  mesh.setIndices(meshData.opaqueIndices)
  // mesh.setVerticesData('uv', meshData.opaqueUVs)

  const mat = voxelShader(scene as any, 'default')
  mesh.material = mat

  mesh.scaling.set(2, 2, 2)
  // mesh.rotation.x = Math.PI / 2
  mesh.bakeCurrentTransformIntoVertices()

  mesh.position.set(-1, -1, -1)
  mesh.bakeCurrentTransformIntoVertices()

  return mesh

  // const w = field.shape[0]
  // const h = field.shape[1]

  // // Generate a convex hull in grid space (naive full bounding rect)
  // const islandMeshes: BABYLON.Mesh[] = []

  // for (let x = 0; x <= w; x++) {
  //   for (let z = 0; z <= h; z++) {
  //     if (field.get(x, z) === 1) {
  //       const box = BABYLON.MeshBuilder.CreateBox('islandCube', { size: 1 }, scene)
  //       box.position.set(x, 0.5, z)
  //       islandMeshes.push(box)
  //     }
  //   }
  // }

  // const merged = BABYLON.Mesh.MergeMeshes(islandMeshes, true, true)
  // if (!merged) {
  //   throw new Error('Failed to merge island meshes')
  // }

  // // for (const m of islandMeshes) {
  // //   m.dispose()
  // // }

  // merged.bakeCurrentTransformIntoVertices()

  // return merged
}

function getParcel(id: number, mesh: BABYLON.Mesh): ProspectiveParcel {
  const position = mesh.position
  const scale = mesh.scaling.multiplyByFloats(0.5, 0.5, 0.5).floor()

  const x1 = Math.floor(position.x) - scale.x + 1
  const y1 = 0
  const z1 = Math.floor(position.z) - scale.z + 1

  const x2 = x1 + scale.x * 2
  const y2 = y1 + scale.y * 2
  const z2 = z1 + scale.z * 2

  return {
    id,
    x1,
    y1,
    z1,
    x2,
    y2,
    z2,
    mesh,
  }
}
