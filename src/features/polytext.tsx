import { isBatterySaver } from '../../common/helpers/detector'
import { PolytextRecord, PolytextV2Record } from '../../common/messages/feature'
import { Position, Rotation, Scale, Behaviours, EditorProps } from '../../web/src/components/editor'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, FeatureID, Toolbar } from '../ui/features'
import { TimeOfDay } from '../utils/time-of-day'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import { MeshExtended, NonMeshedFeature } from './feature'
import { getMonoWorker, type FontData } from '../mono'
import type { Mono } from '../mono'

type PolytextDescription = PolytextRecord | PolytextV2Record

let workerAPI: Mono | null = null
let workerPromise: Promise<Mono> | null = null
let pendingFontData: FontData | null = null
let renderJob = 0

export default class Polytext extends NonMeshedFeature<PolytextDescription> {
  static metadata: FeatureMetadata = {
    title: 'Polytext',
    subtitle: '3d text',
    type: 'polytext',
    image: '/icons/polytext.png',
  }
  static template: FeatureTemplate = {
    type: 'polytext',
    scale: [0.2, 0.2, 0.2],
    rotate: [0, Math.PI / 2, 0],
    text: 'Text',
  }

  private light?: BABYLON.DirectionalLight

  static Load() {
    if (isBatterySaver()) {
      console.log('Battery saver mode, skipping polytext worker load')
      return
    }

    workerPromise = getMonoWorker()
      .then((worker) => {
        workerAPI = worker
        if (pendingFontData) {
          worker.setFontData(pendingFontData)
        }
        return worker
      })
      .catch((error) => {
        console.error('[Polytext] Failed to load worker:', error)
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

  refreshCollidable() {
    if (this.mesh && this.mesh.getChildMeshes()[0]) {
      this.mesh.getChildMeshes()[0].checkCollisions = this.withinBounds && !!(this.description as PolytextV2Record).collidable
    }
  }

  generate() {
    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.diffuseColor.set(1, 1, 1)

    if (this.description.color) {
      material.diffuseColor = BABYLON.Color3.FromHexString(this.description.color)
    }

    const desc = this.description as PolytextV2Record
    if (desc.emissiveColor) {
      material.emissiveColor = BABYLON.Color3.FromHexString(desc.emissiveColor)
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
      renderJob++

      const processText = (worker: Mono) => {
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

            vertexData.positions = positions
            vertexData.indices = indices
            vertexData.normals = normals
            vertexData.uvs = uvs
            vertexData.applyToMesh(mesh)

            mesh.isPickable = true
            mesh.checkCollisions = this.withinBounds && !!desc.collidable
            mesh.material = material

            if (this.description.edges) {
              mesh.enableEdgesRendering()
              mesh.edgesColor = material.diffuseColor
                .clone()
                .multiply(new BABYLON.Color3(0.3, 0.3, 0.3))
                .toColor4(0.5)
              mesh.edgesWidth = 0.6
            }
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

class Editor extends FeatureEditor<Polytext> {
  constructor(props: FeatureEditorProps<Polytext>) {
    super(props)

    const desc = props.feature.description as PolytextV2Record
    this.state = {
      id: props.feature.description.id,
      text: props.feature.description.text,
      color: props.feature.description.color,
      emissiveColor: desc.emissiveColor,
      specularColor: props.feature.description.specularColor,
      edges: props.feature.description.edges,
      collidable: desc.collidable,
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
                </form>
              </div>

              <Behaviours feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

Polytext.Editor = Editor
