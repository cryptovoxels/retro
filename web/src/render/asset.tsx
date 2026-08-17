import { useEffect, useState } from 'preact/hooks'
import type { Assetish } from '../asset'
import type { ParcelRecord } from '../../../common/messages/parcel'
import { VoxImporter } from '../../../common/vox-import/vox-import'
import { NullGrid } from '../../../src/null-grid'
import Parcel from '../../../src/parcel'
function createAssetScene(engine: BABYLON.Engine): BABYLON.Scene {
  const scene = new BABYLON.Scene(engine)
  scene.clearColor.set(0, 0, 0, 0)
  const vi = new VoxImporter()
  vi.initialize(scene)
  return scene
}

type Props = {
  id?: string
  path?: string
}

const blankSpace: ParcelRecord = {
  id: 1,
  kind: 'plot',
  parcel_users: [],
  lightmap_url: null,
  name: 'Blank Space',
  x1: -4,
  y1: 0,
  z1: -4,
  x2: 4,
  y2: 8,
  z2: 4,
  island: 'The void',
  suburb: 'The void',
  address: 'Unknown address',
  owner: '',
  hash: null,
  // Properties from SimpleParcelRecord
  height: 0,
  distance_to_center: 0,
  distance_to_ocean: 0,
  distance_to_closest_common: 0,
  // Properties from SingleParcelRecord
  scripting: undefined,
  description: null,
  label: null,
  is_common: false,
  sandbox: false,
  tileset: null,
  brightness: null,
  palette: null,
  vox: undefined,
  visible: true,
  features: [],
  settings: {
    tokensToEnter: [],
    hosted_scripts: false,
    script_host_url: undefined,
  },
  voxels: '',
  geometry: null as any, // or whatever your default is, e.g. { type: "Polygon", coordinates: [] }
}

function zoomCamera(camera: BABYLON.ArcRotateCamera, scene: BABYLON.Scene) {
  const extents = scene.getWorldExtends()
  const bounds = new BABYLON.BoundingBox(extents.min, extents.max)

  // Set isometric angles
  camera.alpha = Math.PI / 4 // 45°
  camera.beta = Math.acos(1 / Math.sqrt(3)) // ≈ 54.7356°

  // Center the camera
  camera.target = bounds.center

  // Enable orthographic projection
  camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA

  // Calculate zoom extent for ortho size
  const extent = bounds.extendSize.length()
  const orthoSize = extent * 1.5 // tweak this factor as needed

  camera.orthoLeft = -orthoSize
  camera.orthoRight = orthoSize
  camera.orthoTop = orthoSize
  camera.orthoBottom = -orthoSize

  // Optionally clamp zoom level / distance if switching modes later
  camera.radius = extent * 6.942 // not used in ortho mode, but keep for fallback
}

// {  "id": "bf3f5e0b-7c7c-4d0a-8fec-d5c3ebd4b94e", "name": "Boombox", "description": "A powerful 80s style boombox. \n\nDon't forget to insert 8 f*ng D batteries and start the party: \"To the bang bang boogie, say up jump the boogie, to the rhythm of the boogie, the beat.\"", "author": "0xe13d4abee4b304b67c52a56871141cad1b833aa7", "issues": 5, "token_id": 49, "created_at": "2021-12-11T07:44:07.202Z", "updated_at": null, "hash": "db7834643c9e808490b0deaf6f030749f4f5c84d", "rejected_at": null, "offer_prices": null, "collection_id": 1, "custom_attributes": null, "suppressed": false, "category": "facewear", "default_settings": null, "type": "wearable" }

async function loadAsset(scene: BABYLON.Scene, asset: Assetish) {
  var features = asset.content ?? []

  if (asset.type === 'wearable') {
    // features = [asset.content]

    features.push({
      type: 'vox-model',
      url: `https://www.voxels.com/api/wearables/${asset.id}/vox?nonce=${Math.random()}`,
      scale: [2, 2, 2],
      position: [0, 1, 0],
    })

    console.log(features)
  } else if (features.length === 1) {
    const f = features[0]

    f.rotation = [0, 0, 0]

    if (f.type == 'group') {
      features = f.children
    }

    if (!f.position) {
      f.position = [0, 1, 0]
      f.scale = [2, 2, 2]
    }
  }

  const description = Object.assign({}, blankSpace, { features })
  console.log(description)

  // World origin
  const parent = new BABYLON.TransformNode('parcel/parent', scene)
  const parcel = new Parcel(scene, parent, description, new NullGrid(scene))
  parcel.generate()

  // I'm not 100% sure this actually waits until all the assets have loaded
  await parcel.activate()

  // Give a small delay to let it render
  setTimeout(() => {
    // Zoom real good
    zoomCamera(scene.activeCamera as BABYLON.ArcRotateCamera, scene)
  }, 50)

  setTimeout(() => {
    // We're good to render mr chrome!
    document.body.classList.add('done-loading')
  }, 100)
}

export default function RenderAsset(props: Props) {
  const [asset, setAsset] = useState<Assetish | null>(null)
  var scene: BABYLON.Scene

  async function fetchAsset(id: string) {
    const f = await fetch(`/api/assets/${id}`)
    const j = await f.json()

    if (!j.asset) {
      alert('Asset not found')
      return
    }

    setAsset(j.asset)
    loadAsset(scene, j.asset)
  }

  useEffect(() => {
    const canvas = document.getElementById('rendering-canvas') as unknown as HTMLCanvasElement
    if (!canvas) {
      return
    }

    canvas.width = 512
    canvas.height = 1024

    const engine = new BABYLON.Engine(canvas, true)

    scene = createAssetScene(engine)

    const camera = new BABYLON.ArcRotateCamera('wearable-camera', Math.PI / 4, Math.acos(1 / Math.sqrt(3)), 8, new BABYLON.Vector3(0, 0, 0), scene)
    camera.fov = 0.4
    camera.useAutoRotationBehavior = false
    camera.attachControl(canvas, true)

    const light = new BABYLON.HemisphericLight('light1', new BABYLON.Vector3(0, 1, 0), scene)
    light.intensity = 1.0

    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -1, 1), scene)
    sun.intensity = 2.0

    scene.ambientColor = new BABYLON.Color3(1, 1, 1) // full white ambient

    // Lighting
    // createRingLight(scene, scene.activeCamera as BABYLON.Camera)

    // ground.position.y = -0.5

    const t = new BABYLON.Texture('/textures/01-grid.png', scene)
    t.uScale = 1024
    t.vScale = 1024

    const mat = new BABYLON.StandardMaterial('ground', scene)
    mat.diffuseTexture = t

    // const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 512, height: 512 }, scene)
    // ground.material = mat

    // Load costme
    if (props.id) {
      fetchAsset(props.id)
    } else {
      alert('No id supplied')
    }

    engine.runRenderLoop(() => {
      scene.render()
    })
  }, [])

  // const hue = props.id ? (parseInt(props.id, 10) * 654347) % 360 : 0
  // const hue = 16
  // const cssText = `background: linear-gradient(hsl(${hue}deg, 100%, 50%), #000);`

  // console.log(background)

  return <canvas id="rendering-canvas" />
}
