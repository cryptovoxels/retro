import { createComlinkWorker } from '../../common/helpers/comlink-worker'
import { isBatterySaver } from '../../common/helpers/detector'
import { PolytextV2Record } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, SetParentDropdown, Toolbar, UuidReadOnly } from '../ui/features'
import { TimeOfDay } from '../utils/time-of-day'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { MeshExtended, NonMeshedFeature } from './feature'
import type { FontData, PolytextV2WorkerAPI } from './polytext-v2-worker'
let workerAPI: PolytextV2WorkerAPI | null = null
let workerCleanup: (() => void) | null = null
let workerPromise: Promise<PolytextV2WorkerAPI> | null = null
let pendingFontData: FontData | null = null
let renderJob = 0

export default class PolytextV2 extends NonMeshedFeature<PolytextV2Record> {
  static metadata: FeatureMetadata = {
    title: 'Polytext',
    subtitle: '3d text',
    type: 'polytext-v2',
    image: '/icons/polytext.png',
  }
  static template: FeatureTemplate = {
    type: 'polytext-v2',
    scale: [0.2, 0.2, 0.2],
    rotate: [0, Math.PI / 2, 0],
    text: 'Text',
  }

  private light?: BABYLON.DirectionalLight

  get isV2() {
    return true
  }

  static Load() {
    if (isBatterySaver()) {
      console.log('Battery saver mode, skipping polytext-v2 worker load')
      return
    }

    workerPromise = createComlinkWorker<PolytextV2WorkerAPI>(
      // Webpack 5 recognizes this exact pattern and automatically compiles TypeScript workers to separate bundles
      () => new Worker(new URL('./polytext-v2-worker.ts', import.meta.url)),
      () => import('./polytext-v2-worker').then(({ polytextV2Worker }) => polytextV2Worker),
      { debug: true, workerName: 'polytext-v2-worker' },
    )
      .then(({ worker, cleanup, isWorker }) => {
        workerAPI = worker
        workerCleanup = cleanup
        if (pendingFontData) {
          worker.setFontData(pendingFontData)
        }
        return worker
      })
      .catch((error) => {
        console.error('[PolytextV2] Failed to load polytext-v2 worker:', error)
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
          console.error('[PolytextV2] Failed to set font data:', error)
        })
    }
  }

  toString() {
    return this.description.text || super.toString()
  }

  whatIsThis() {
    return <label>Show customized 3d text! </label>
  }

  refreshCollidable() {
    if (this.mesh && this.mesh.getChildMeshes()[0]) {
      this.mesh.getChildMeshes()[0].checkCollisions = this.withinBounds && !!this.description.collidable
    }
  }

  generate() {
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseColor.set(1, 1, 1)

    if (this.description.color) {
      material.diffuseColor = BABYLON.Color3.FromHexString(this.description.color)
    }

    if (this.description.emissiveColor) {
      material.emissiveColor = BABYLON.Color3.FromHexString(this.description.emissiveColor)
    }

    if (typeof this.description.specularColor == 'string') {
      material.specularColor = BABYLON.Color3.FromHexString(this.description.specularColor)
    } else {
      material.specularColor.fromArray(this.description.specularColor || [1, 1, 1])
    }
    material.blockDirtyMechanism = true

    const text = this.description.text?.slice(0, 24)

    const parent = new BABYLON.TransformNode(this.uniqueEntityName('parent'), this.scene)

    const mesh = new BABYLON.Mesh(this.uniqueEntityName('mesh'), this.scene) as MeshExtended
    mesh.setParent(parent)

    if (text?.length) {
      // don't request a mesh job if there is no text.
      renderJob++

      const processText = (worker: PolytextV2WorkerAPI) => {
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
            mesh.checkCollisions = this.withinBounds && !!this.description.collidable
            mesh.material = material

            if (this.description.edges) {
              mesh.enableEdgesRendering()
              mesh.edgesColor = material.diffuseColor
                .clone()
                .multiply(new BABYLON.Color3(0.3, 0.3, 0.3))
                .toColor4(0.5) // new BABYLON.Color4(0.1, 0.1, 0.1, 1)
              mesh.edgesWidth = 0.6
            }
          })
          .catch((error) => {
            console.error('[PolytextV2] Polytext generation failed:', error)
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
            console.error('[PolytextV2] Failed to load worker for text processing:', error)
          })
      } else {
        console.warn('[PolytextV2] No worker or worker promise available for text:', text)
      }

      // Create per-instance DirectionalLight (like original polytext) instead of global light
      // This provides proper shading without affecting other scene meshes
      let lightValue = 0.95
      if (window.environment?.timeOfDay == TimeOfDay.Night) {
        lightValue = 0.01
      }

      const lightDirection = new BABYLON.Vector3(-1, -8, 1)
      this.light = new BABYLON.DirectionalLight(this.uniqueEntityName('light'), lightDirection, this.scene)
      this.light.diffuse = new BABYLON.Color3(lightValue, lightValue, lightValue)
      this.light.specular = new BABYLON.Color3(lightValue, lightValue, lightValue)
      this.light.parent = parent
      this.light.includedOnlyMeshes = [mesh]
    }
    mesh.isPickable = true
    mesh.feature = this

    this.mesh = parent as MeshExtended

    this.setCommon()
    this.addAnimation()
    this.refreshCollidable()

    return Promise.resolve()
  }

  _dispose() {
    if (this.light) {
      this.light.dispose()
      this.light = undefined
    }
    super._dispose()
  }

  afterSetCommon = () => {
    this.refreshCollidable()
  }
}

class Editor extends FeatureEditor<PolytextV2> {
  constructor(props: FeatureEditorProps<PolytextV2>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      text: props.feature.description.text,
      color: props.feature.description.color,
      emissiveColor: props.feature.description.emissiveColor,
      specularColor: props.feature.description.specularColor,
      edges: props.feature.description.edges,
      collidable: props.feature.description.collidable,
    }
  }

  componentDidUpdate() {
    this.merge({
      text: this.state.text,
      color: this.state.color,
      emissiveColor: this.state.emissiveColor,
      specularColor: this.state.specularColor,
      edges: this.state.edges,
      collidable: this.state.collidable,
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
          <div className="f color-selectors">
            <div>
              <label>Diffuse Color</label>
              <input type="color" value={this.state.color} onInput={(e) => this.setState({ color: e.currentTarget.value })} />
              <small>
                <button title="Reset" onClick={() => this.setState({ color: '#FFFFFF' })}>
                  Reset
                </button>
              </small>
            </div>
            <div>
              <label>Specular Color</label>
              <input type="color" value={this.state.specularColor} onInput={(e) => this.setState({ specularColor: e.currentTarget.value })} />
              <small>
                <button title="Reset" onClick={() => this.setState({ specularColor: '#FFFFFF' })}>
                  Reset
                </button>
              </small>
            </div>
            <div>
              <label>Emissive Color</label>
              <input type="color" value={this.state.emissiveColor} onInput={(e) => this.setState({ emissiveColor: e.currentTarget.value })} />
              <small>
                <button title="Reset" onClick={() => this.setState({ emissiveColor: '#000000' })}>
                  Reset
                </button>
              </small>
            </div>
          </div>

          <Advanced>
            <FeatureID feature={this.props.feature} />
            <SetParentDropdown feature={this.props.feature} />

            <div className="f">
              <label>
                <input type="checkbox" checked={this.state.edges} onInput={(e) => this.setState({ edges: (e as any).target['checked'] })} />
                Edges
              </label>
            </div>

            <div className="f">
              <form>
                <input type="checkbox" name="collidable" onChange={(e) => this.setState({ collidable: e.currentTarget.checked })} checked={this.state.collidable}></input>
                <label for="collidable">Enable Collision</label>
                <small>Model must be within the parcel bounds</small>
              </form>
            </div>
            <UuidReadOnly feature={this.props.feature} />

            <Behaviours feature={this.props.feature} />
          </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

PolytextV2.Editor = Editor
