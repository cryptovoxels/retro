import { createComlinkWorker } from '../../common/helpers/comlink-worker'
import { isBatterySaver } from '../../common/helpers/detector'
import { PolytextRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, SetParentDropdown, SpecularColorSetting, Toolbar, UuidReadOnly } from '../ui/features'
import { MeshExtended, NonMeshedFeature } from './feature'
import type { FontData } from './polytext-v2-worker'
import type { PolytextWorkerAPI } from './polytext-worker'

let workerAPI: PolytextWorkerAPI | null = null
let workerPromise: Promise<PolytextWorkerAPI> | null = null
let pendingFontData: FontData | null = null
let renderJob = 0

export default class Polytext extends NonMeshedFeature<PolytextRecord> {
  private light?: BABYLON.DirectionalLight

  static Load() {
    if (isBatterySaver()) {
      console.log('Battery saver mode, skipping polytext-v2 worker load')
      return
    }

    workerPromise = createComlinkWorker<PolytextWorkerAPI>(
      // Webpack 5 recognizes this exact pattern and automatically compiles TypeScript workers to separate bundles
      () => new Worker(new URL('./polytext-worker.ts', import.meta.url)),
      () => import('./polytext-worker').then(({ polytextWorker }) => polytextWorker),
      { debug: true, workerName: 'polytext-worker' },
    )
      .then(({ worker }) => {
        workerAPI = worker
        if (pendingFontData) {
          worker.setFontData(pendingFontData)
        }
        return worker
      })
      .catch((error) => {
        console.error('[Polytext] Failed to load polytext worker:', error)
        workerAPI = null
        throw error
      })
  }

  static setWorkerData = (font: FontData) => {
    pendingFontData = font
    if (workerAPI) {
      workerAPI.setFontData(font)
    } else if (workerPromise) {
      workerPromise
        .then((worker) => {
          if (pendingFontData) {
            worker.setFontData(pendingFontData)
          }
        })
        .catch((error) => {
          console.error('[Polytext] Failed to set font data:', error)
        })
    }
  }

  toString() {
    return this.description.text || super.toString()
  }

  whatIsThis() {
    return <label>Show customized 3d text! </label>
  }

  generate() {
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseColor.set(0, 0, 0)
    material.emissiveColor.set(0.8, 0.8, 0.8)

    if (this.description.color) {
      material.emissiveColor = BABYLON.Color3.FromHexString(this.description.color)
    }

    material.specularColor.fromArray(this.description.specularColor || [1, 1, 1])

    material.blockDirtyMechanism = true
    const text = this.description.text?.slice(0, 24)

    if (text?.length) {
      // don't request a mesh job if there is no text.
      renderJob++

      const processText = (worker: PolytextWorkerAPI) => {
        return worker
          .meshText(text, renderJob)
          .then((data) => {
            const { positions, indices, uvs } = data

            if (positions.length === 0) {
              return
            }

            const normals: number[] = []
            const vertexData = new BABYLON.VertexData()
            BABYLON.VertexData.ComputeNormals(positions, indices, normals)

            // Assign positions, indices and normals to vertexData
            vertexData.positions = positions
            vertexData.indices = indices
            vertexData.normals = normals
            vertexData.uvs = uvs
            vertexData.applyToMesh(mesh)

            mesh.isPickable = true
            mesh.checkCollisions = true
            mesh.material = material

            if (this.description.edges) {
              mesh.enableEdgesRendering()
              mesh.edgesColor = material.diffuseColor
                .clone()
                .multiply(new BABYLON.Color3(0.3, 0.3, 0.3))
                .toColor4(0.5) // new BABYLON.Color4(0.1, 0.1, 0.1, 1)
              mesh.edgesWidth = 0.6
            }

            const bounds = mesh.getBoundingInfo()
            mesh.position.z = bounds.maximum.x / -2
          })
          .catch((error) => {
            console.error('[Polytext] Polytext generation failed:', error)
          })
      }

      if (workerAPI) {
        processText(workerAPI)
      } else if (workerPromise) {
        workerPromise
          .then((worker) => {
            return processText(worker)
          })
          .catch((error) => {
            console.error('[Polytext] Failed to load worker for text processing:', error)
          })
      } else {
        console.warn('[Polytext] No worker or worker promise available for text:', text)
      }
    }

    const parent = new BABYLON.TransformNode(this.uniqueEntityName('parent'), this.scene)

    const mesh = new BABYLON.Mesh(this.uniqueEntityName('mesh'), this.scene) as MeshExtended
    mesh.setParent(parent)
    mesh.rotate(BABYLON.Axis.Z, -Math.PI / 2)
    mesh.rotate(BABYLON.Axis.Y, -Math.PI / 2)

    // create a light that shines on the front of the mesh (and just this mesh)
    const lightDirection = new BABYLON.Vector3(-1, 0, 0)
    this.light = new BABYLON.DirectionalLight(this.uniqueEntityName('light'), lightDirection, this.scene)
    this.light.parent = parent
    this.light.specular = new BABYLON.Color3(1, 1, 1)
    this.light.includedOnlyMeshes.push(mesh)

    mesh.isPickable = true
    mesh.feature = this

    //@Todo: fix casting here
    this.mesh = parent as MeshExtended
    this.setCommon()
    this.addAnimation()

    return Promise.resolve()
  }

  _dispose() {
    if (this.light) {
      this.light.dispose()
      this.light = undefined
    }
    super._dispose()
  }
}

class Editor extends FeatureEditor<Polytext> {
  constructor(props: FeatureEditorProps<Polytext>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      text: props.feature.description.text,
      color: props.feature.description.color,
      edges: props.feature.description.edges,
    }
  }

  componentDidUpdate() {
    this.merge({
      text: this.state.text,
      color: this.state.color,
      edges: this.state.edges,
    })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Polytext</h2>
          <button onClick={this.onBackClick} class="close">
            <span>&times;</span>
          </button>
        </header>
        <div className="scrollContainer">
          <Toolbar feature={this.props.feature} scene={this.props.scene} />
          <EditorProps>
          {/* keys are provided so that the getState in the component is reset after gizmo is used */}
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />
          <Animation feature={this.props.feature} />

          <div className="f">
            <label>Text</label>
            <input type="text" value={this.state.text} onInput={(e) => this.setState({ text: e.currentTarget.value })} />
            <small>(Only up to 12 characters supported)</small>
          </div>
          <div className="f">
            <label>Color</label>
            <input type="color" value={this.state.color} onInput={(e) => this.setState({ color: e.currentTarget.value })} />
          </div>

          <Advanced>
            <FeatureID feature={this.props.feature} />
            <SetParentDropdown feature={this.props.feature} />

            <div className="f">
              <label>
                <input type="checkbox" checked={this.state.edges} onInput={(e) => this.setState({ edges: e.currentTarget.checked })} />
                Edges
              </label>
            </div>
            <SpecularColorSetting feature={this.props.feature} />
            <UuidReadOnly feature={this.props.feature} />

            <Behaviours feature={this.props.feature} />
          </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Polytext.Editor = Editor
