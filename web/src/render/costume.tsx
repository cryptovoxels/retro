import { useEffect, useState } from 'preact/hooks'
import { Costume } from '../../../common/types'
import voxImport from '../../../common/vox-import/sync-vox-import'
import { createRingLight } from '../helpers/scenes'

type Props = {
  id?: string
  path?: string
}

async function loadCostume(scene: BABYLON.Scene, costume: Costume) {
  const imported = await BABYLON.SceneLoader.ImportMeshAsync(null, `/models/`, 'avatar.glb', scene)

  const material = new BABYLON.StandardMaterial(`material/costume`, scene)
  material.diffuseColor.set(0.82, 0.81, 0.8)
  material.emissiveColor.set(0.1, 0.1, 0.1)
  material.specularPower = 1000
  material.blockDirtyMechanism = true

  const mesh = imported.meshes[0] as BABYLON.Mesh
  // mesh.visibility = 0
  // mesh.isPickable = false
  mesh.position.y = -1

  const armature = imported.meshes[1] as BABYLON.Mesh
  armature.material = material
  armature.isPickable = false
  const skeleton = imported.skeletons[0]

  const bones = skeleton.bones.filter((b: BABYLON.Bone) => !b.name.match(/index/i))
  const hips = bones[0]
  // hips.getTransformNode()?.rotate(BABYLON.Axis.Y, Math.PI)

  // const s = 1 / 50

  for (let a of costume.attachments!) {
    console.log(a)

    const mesh = await voxImport(`/api/collectibles/${a.wid}/vox`, scene)
    // mesh.scaling.set(s, s, s)
    // mesh.bakeCurrentTransformIntoVertices()

    // Attach vox to bone
    const bone = skeleton.bones.find((b) => b.name.match(a.bone))!
    mesh.attachToBone(bone, armature)
    console.log(bone)

    // Position
    mesh.position = new BABYLON.Vector3(a.position[0], a.position[1], a.position[2])

    // Scaling
    mesh.scaling.set(a.scaling[0], a.scaling[1], a.scaling[2])

    // Rotation
    const rotation = new BABYLON.Vector3(BABYLON.Angle.FromDegrees(a.rotation[0]).radians(), BABYLON.Angle.FromDegrees(a.rotation[1]).radians(), BABYLON.Angle.FromDegrees(a.rotation[2]).radians())
    mesh.rotation = rotation
  }

  document.body.classList.add('done-loading')
}

export default function RenderCostume(props: Props) {
  const [costume, setCostume] = useState<Costume | null>(null)
  var scene: BABYLON.Scene

  async function fetchCostume(id: string) {
    const f = await fetch(`/api/costumes/${id}`)
    const j = await f.json()

    if (!j.costume) {
      alert('Costume not found')
      return
    }

    setCostume(j.costume)
    loadCostume(scene, j.costume)
  }

  useEffect(() => {
    const canvas = document.getElementById('rendering-canvas') as unknown as HTMLCanvasElement
    if (!canvas) {
      return
    }

    canvas.width = 512
    canvas.height = 1024

    const engine = new BABYLON.Engine(canvas, true)

    // Render on a transparent background
    scene = new BABYLON.Scene(engine)
    scene.clearColor.set(0, 0, 0, 0)

    const camera = new BABYLON.ArcRotateCamera('wearable-camera', Math.PI / 3, Math.PI / 3, 5, new BABYLON.Vector3(0, 0, 0), scene)
    camera.fov = 0.5
    camera.useAutoRotationBehavior = false
    camera.attachControl(canvas, true)

    // Lighting
    createRingLight(scene, scene.activeCamera as BABYLON.Camera)

    // Load costme
    if (props.id) {
      fetchCostume(props.id)
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
