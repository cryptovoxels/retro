import { Component } from 'preact'
import { render, unmountComponentAtNode, useState } from 'preact/compat'
import Connector from '../../connector'
import { showAreaContentAnalyzeUI } from '../../controls/desktop/area-content-analyzer'
import { Environment } from '../../enviroments/environment'
import type Grid from '../../grid'
import type Parcel from '../../parcel'
import { toggleFPSStats } from '../../utils/fps-stats'
import { TimeOfDay } from '../../utils/time-of-day'

interface Props {
  parcel: Parcel | null
  scene: BABYLON.Scene
  environment: Environment
}

interface State {
  showBoundingBoxes: boolean
  showSpectrumAnalyser: boolean
  gridIsOpen: boolean
  multiplayerIsOpen: boolean
  nightTime: boolean
  parcelBoundingBoxes: BABYLON.Mesh[]
  isGridWorkerRunning: boolean
}

export default class DebugTools extends Component<Props, State> {
  static previousState: State
  spectrumAnalyser: BABYLON.Analyser

  constructor(props: Props) {
    super(props)

    this.state = {
      showBoundingBoxes: !!DebugTools.previousState?.showBoundingBoxes,
      showSpectrumAnalyser: !!DebugTools.previousState?.showSpectrumAnalyser,
      parcelBoundingBoxes: DebugTools.previousState?.parcelBoundingBoxes || [],
      gridIsOpen: this.grid.isOpen,
      multiplayerIsOpen: this.connector.isOpen,
      nightTime: this.environment.timeOfDay == TimeOfDay.Night,
      isGridWorkerRunning: this.grid.isWorkerRunning,
    }

    this.spectrumAnalyser = new BABYLON.Analyser(this.scene)
    DebugTools.previousState = this.state
  }

  get grid() {
    return window.grid as Grid
  }

  get environment() {
    return this.props.environment
  }

  get scene() {
    return this.props.scene
  }

  get connector() {
    return window.connector as Connector
  }

  get ui() {
    return window.ui
  }

  get currentParcel() {
    return this.props.parcel
  }

  componentDidUpdate() {
    DebugTools.previousState = this.state
  }

  unloadParcel() {
    const p = this.grid?.currentOrNearestParcel()
    if (p) {
      this.grid.unload(p)
    }
  }

  isolateParcel() {
    this.grid?.isolate(this.grid.currentParcel())
  }

  async createMeshAt() {
    const [position, parent] = await createMeshAtPopUp()

    if (!position) {
      return
    }
    const m = BABYLON.MeshBuilder.CreateSphere('debug/sphere', { diameter: 0.8 }, this.props.scene)
    const parcel = this.grid.currentOrNearestParcel()
    if (parent == 'parcel' && parcel) {
      m.parent = parcel.transform
    } else {
      const controls = this.connector.controls
      m.parent = controls.worldOffset
    }
    m.position = position
    console.log('Mesh Created at ', position)
    console.log('Parent of mesh ', parent)
  }

  toggleTimeOfDay() {
    this.setState({ nightTime: !this.state.nightTime }, () => {
      if (!this.environment) {
        return
      }
      let time = TimeOfDay.Day
      if (this.environment.timeOfDay == TimeOfDay.Day) {
        time = TimeOfDay.Night
      }
      this.environment.timeOfDay = time
      this.environment.update()
    })
  }

  toggleMultiplayer() {
    this.setState({ multiplayerIsOpen: !this.state.multiplayerIsOpen }, () => {
      if (this.connector.isOpen) {
        this.connector.disconnect()
      } else {
        this.connector.connect()
      }
    })
  }

  toggleGrid() {
    this.setState({ gridIsOpen: !this.state.gridIsOpen }, () => {
      if (this.grid.isOpen) {
        this.grid.disconnect()
      } else {
        this.grid.connect()
      }
    })
  }

  toggleGridWorker() {
    this.setState({ isGridWorkerRunning: !this.state.isGridWorkerRunning }, () => {
      if (this.grid.isWorkerRunning) {
        this.grid.unloadWorker()
      } else {
        this.grid.loadWorker()
      }
    })
  }

  toggleCurrentParcelBoundingBoxes() {
    this.state.parcelBoundingBoxes.forEach((m) => {
      m?.dispose()
    })
    this.setState({ parcelBoundingBoxes: [] })
    const parcel = this.grid.currentOrNearestParcel()
    if (!parcel) {
      console.error('No parcel close enough to you')
      return
    }
    this.setState({ parcelBoundingBoxes: visualizeParcelBoundingBoxes(parcel, this.scene) })
  }

  toggleBoundingBoxes() {
    this.setState({ showBoundingBoxes: !this.state.showBoundingBoxes }, () => {
      this.scene.meshes.forEach((m) => {
        return (m.showBoundingBox = this.state.showBoundingBoxes)
      })
    })
  }

  toggleSpectrumAnalyser() {
    this.setState({ showSpectrumAnalyser: !this.state.showSpectrumAnalyser }, () => {
      if (this.state.showSpectrumAnalyser) {
        this.spectrumAnalyser.DEBUGCANVASPOS.x = 120
        this.spectrumAnalyser.DEBUGCANVASPOS.y = 30
        BABYLON.Engine.audioEngine?.connectToAnalyser(this.spectrumAnalyser)
        this.spectrumAnalyser.drawDebugCanvas()
      } else {
        this.spectrumAnalyser.stopDebugCanvas()
      }
    })
  }

  render() {
    return (
      <section className="debug-tools-overlay">
        <header>
          <h2>{`Debug tools`}</h2>
        </header>
        <div className="scrollContainer">
          <p>A moderator tool for easier debugging.</p>
          <section className="overlay-parcel-info-content">
            <div>
              <h4>Toggles</h4>
            </div>
            <div style={{ display: 'grid', gap: '4px', gridTemplateColumns: '1fr 1fr' }}>
              <button onClick={() => toggleFPSStats()} title="Toggle the FPS indicator.">
                Toggle FPS Stats.
              </button>
              <button onClick={() => this.toggleTimeOfDay()} title="Toggle the time of the day.">
                {this.state.nightTime ? 'Set day time' : 'Set night time'}
              </button>
              <button onClick={() => this.toggleMultiplayer()} title="Toggle the Multiplayer service.">
                {this.state.multiplayerIsOpen ? 'Turn off Multiplayer.' : 'Turn on Multiplayer'}
              </button>
              <button onClick={() => this.toggleGrid()} title="Toggle the Grid service.">
                {this.state.gridIsOpen ? 'Turn off Grid.' : 'Turn on Grid'}
              </button>
              <button onClick={() => this.toggleBoundingBoxes()} title="Toggle the Bounding boxes.">
                {this.state.showBoundingBoxes ? 'Turn off bounding Boxes.' : 'Turn on bounding Boxes'}
              </button>
              <button onClick={() => this.toggleSpectrumAnalyser()} title="Toggle the audio spectrum analyser">
                {this.state.showSpectrumAnalyser ? 'Turn off audio spectrometer' : 'Turn on audio spectrometer'}
              </button>
              <button onClick={() => this.toggleCurrentParcelBoundingBoxes()} title="Toggle the current parcel bounding boxes">
                Toggle parcel bounding boxes
              </button>
              <button onClick={() => this.toggleGridWorker()} title="Toggle the grid worker">
                Turn {this.state.isGridWorkerRunning ? 'off' : 'on'} the grid worker
              </button>
            </div>
          </section>
          <section className="overlay-parcel-info-content">
            <div>
              <h4>Debug tools</h4>
            </div>
            <div style={{ display: 'grid', gap: '4px', gridTemplateColumns: '1fr 1fr' }}>
              <button onClick={() => this.unloadParcel()} title="Temporarily hide parcel for debug purposes">
                Unload parcel
              </button>
              <button onClick={() => this.isolateParcel()} title="Temporarily hide all other parcels for debug purposes">
                Isolate Parcel
              </button>
              <button onClick={() => this.createMeshAt()} title="Create a sphere at the given location given the parent">
                Create Mesh
              </button>
            </div>
          </section>
          <section className="overlay-parcel-info-content">
            <div>
              <h4>Standalone Debug tools</h4>
            </div>
            <div>
              <button onClick={() => showAreaContentAnalyzeUI(this.scene)}>Area Content Analyzer (ACA)</button>
            </div>
          </section>
        </div>
      </section>
    )
  }
}

type Scope = 'world' | 'parcel'

export async function createMeshAtPopUp(): Promise<[BABYLON.Vector3, Scope] | [null, Scope]> {
  const div = document.createElement('div')
  div.className = ''
  return new Promise(function (resolve, reject) {
    const close = () => {
      unmountComponentAtNode(div)
      div?.remove()
    }

    const resolvePosition = (position: number[], scope: Scope) => {
      const newVector = BABYLON.Vector3.FromArray(position)
      resolve([newVector, scope])
      close()
    }
    const rejectAndClose = () => {
      reject([null, 'world'])
      close()
    }

    document.body.appendChild(div)

    render(<CreateMeshAtPositionWindow rejectAndClose={rejectAndClose} resolveAndClose={resolvePosition} />, div)
  })
}

function CreateMeshAtPositionWindow({ resolveAndClose, rejectAndClose }: { resolveAndClose: (position: number[], scope: Scope) => void; rejectAndClose: () => void }) {
  const [stringValue, setStringValue] = useState<string>('0,0,0')
  const [scope, setScope] = useState<Scope>('world')

  const parseAndSetPosition = () => {
    const p = (stringValue || '').replace(' ', '')
    let array
    try {
      array = p.split(',')
      array = array.map((stringifiedNumber) => parseFloat(stringifiedNumber)).filter((n) => !isNaN(n)) as number[]
      if (array.length != 3) {
        throw new Error('Cant have less or more than 3 numbers')
      }
    } catch (e) {
      console.error(e)
    }
    resolveAndClose(array as number[], scope)
  }

  const getCamera = () => {
    const p = window.connector.controls.camera.position
    setStringValue(p.asArray().join(','))
  }

  return (
    <div className="OverlayWindow -small-width -auto-height">
      <h2>Create Sphere at position</h2>
      <label>Enter x,y,z numbers separated by commas; eg. '3,0,5.2`</label>
      <input name="" value={stringValue} onInput={(e) => setStringValue(e.currentTarget.value)} />
      <button onClick={getCamera}>Get Camera position</button>
      <label>Parent</label>
      <select value={scope} onChange={(e) => setScope(e.currentTarget.value as Scope)}>
        <option value="world">World Offset</option>
        <option value="parcel">Parcel Transform</option>
      </select>
      <button onClick={() => parseAndSetPosition()}>Submit</button>
      <button onClick={() => rejectAndClose()}>Cancel</button>
    </div>
  )
}

function visualizeParcelBoundingBoxes(parcel: Parcel, scene: BABYLON.Scene): [BABYLON.Mesh, BABYLON.Mesh, BABYLON.Mesh] {
  const meshes: [BABYLON.Mesh, BABYLON.Mesh, BABYLON.Mesh] = [null!, null!, null!]

  let bb = parcel.featureBounds
  let width = bb.maximum.x - bb.minimum.x
  let height = bb.maximum.y - bb.minimum.y
  let depth = bb.maximum.z - bb.minimum.z
  const m = BABYLON.MeshBuilder.CreateBox(`parcel/${parcel.id}/featureBounds`, { width, height, depth }, scene)
  m.parent = parcel.transform
  m.material = new BABYLON.StandardMaterial('parcel/blocked', parcel.scene) //Parcel.noNFTShaderMaterial as BABYLON.ShaderMaterial
  m.material.backFaceCulling = false
  m.position = new BABYLON.Vector3(0, height / 2, 0)
  ;(m.material as any).diffuseColor = BABYLON.Color3.Green()
  ;(m.material as any).emissiveColor = new BABYLON.Color3(0.7, 0.7, 0.7)
  ;(m.material as any).alpha = 0.5
  m.material.blockDirtyMechanism = true
  meshes.push(m)

  bb = parcel.boundingBox
  width = bb.maximum.x - bb.minimum.x + 0.2
  height = bb.maximum.y - bb.minimum.y
  depth = bb.maximum.z - bb.minimum.z + 0.2
  const mm = BABYLON.MeshBuilder.CreateBox(`parcel/${parcel.id}/boundingBox`, { width, height, depth }, scene)
  mm.parent = parcel.transform
  mm.position = new BABYLON.Vector3(0, height / 2, 0)
  mm.material = new BABYLON.StandardMaterial('parcel/blocked/blue', parcel.scene) //Parcel.noNFTShaderMaterial as BABYLON.ShaderMaterial
  ;(mm.material as any).diffuseColor = BABYLON.Color3.Blue()
  ;(mm.material as any).emissiveColor = new BABYLON.Color3(0.7, 0.7, 0.7)
  ;(mm.material as any).alpha = 0.5
  mm.material.blockDirtyMechanism = true
  meshes.push(mm)

  const hardBB = parcel.hardFeatureBounds
  width = hardBB.maximum.x - hardBB.minimum.x
  height = hardBB.maximum.y - hardBB.minimum.y
  depth = hardBB.maximum.z - hardBB.minimum.z
  const mmm = BABYLON.MeshBuilder.CreateBox(`parcel/${parcel.id}/HardFeatureBounds`, { width, height, depth }, scene)
  mmm.parent = parcel.transform
  mmm.position = new BABYLON.Vector3(0, height / 2, 0)
  mmm.material = new BABYLON.StandardMaterial('parcel/blocked/blue', parcel.scene) //Parcel.noNFTShaderMaterial as BABYLON.ShaderMaterial
  ;(mmm.material as any).diffuseColor = BABYLON.Color3.Red()
  ;(mmm.material as any).emissiveColor = new BABYLON.Color3(0.7, 0.7, 0.7)
  ;(mmm.material as any).alpha = 0.5
  mmm.material.blockDirtyMechanism = true
  meshes.push(mmm)
  return meshes
}
