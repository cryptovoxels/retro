import { Component } from 'preact'
import type Parcel from '../../parcel'
import { requestPointerLock } from '../../../common/helpers/ui-helpers'
import CustomizeVoxels from './customize-voxels'
import { toggleParcelAdminOverlay } from '../parcel-admin'
import { debounce } from 'lodash'
import { LightmapStatus } from '../../../common/messages/parcel'

interface Props {
  parcel: Parcel | null
  scene: BABYLON.Scene
}

type State = {
  brightness: number | null
  uploading: boolean
}

export default class EditTab extends Component<Props, State> {
  setBrightness = debounce(
    (value: number) => {
      if (this.props.parcel && this.props.parcel.spaceId === undefined) {
        this.setState({ brightness: value })
        this.props.parcel.setBrightness(value)
      }
    },
    200,
    { trailing: true, leading: false },
  )

  constructor(props: Props) {
    super(props)

    this.state = {
      brightness: props.parcel?.brightness ?? null,
      uploading: false,
    }
  }

  get ui() {
    return window.ui
  }

  get controls() {
    return window.connector.controls
  }

  get brightness() {
    const value = this.state.brightness
    return value == null ? 1 : value
  }
  editFeature() {
    this.controls.enterFirstPerson()
    requestPointerLock()
    this.ui?.editFeature()
  }

  replicateFeature() {
    this.controls.enterFirstPerson()
    requestPointerLock()
    this.ui?.editFeatureThenCopy()
  }

  moveFeature() {
    this.controls.enterFirstPerson()
    requestPointerLock()
    this.ui?.editFeatureThenMove()
  }

  render() {
    if (!this.props.parcel) {
      return <div />
    }

    return (
      <section className="tile-selector">
        <div className="scrollContainer">
          <div className="f">
            <h4>Edit Features</h4>
            <small>Right-click on features in world to edit, or use the tools below.</small>
            <ul className="toolbar">
              <li>
                <button title="Click to activate Feature Edit Mode [or press E]" class="-edit" onClick={() => this.editFeature()}>
                  <u>E</u>dit
                </button>
              </li>
              <li>
                <button title="Click to activate Feature Replicate Mode [or press R]" class="-replicate" onClick={() => this.replicateFeature()}>
                  <u>R</u>eplicate
                </button>
              </li>
              <li>
                <button title="Click to activate Feature Move Mode [or press M]" class="-move" onClick={() => this.moveFeature()}>
                  <u>M</u>ove
                </button>
              </li>
            </ul>
          </div>

          <CustomizeVoxels parcel={this.props.parcel} scene={this.props.scene} />
        </div>
      </section>
    )
  }
}
