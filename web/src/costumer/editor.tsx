import { Component } from 'preact'
import * as _ from 'lodash'
import { Costume } from '../../../common/messages/costumes'
import { Attachment } from './index'
import { VectorField } from '../components/editor/fields/vector-field'

interface Props {
  attachmentIdx: number
  updateAttachment: (a: Attachment) => void
  deleteAttachment: (attachmentIdx: number) => void
  costume: Costume | null
}

interface State {
  position: number[]
  scaling: number[]
  rotation: number[]
  expandScale: boolean
  error?: string
}

export const limitNumber = (value: number, min: number, max: number) => {
  value = value > max ? max : value
  value = value < min ? min : value
  return parseFloat(value.toString())
}

export class Editor extends Component<Props, State> {
  deleteAttachment = (e: Event) => {
    this.props.deleteAttachment(this.props.attachmentIdx)
  }

  get attachment(): Attachment | null {
    if (!this.props.costume) {
      return null
    }
    return this.props.costume.attachments?.[this.props.attachmentIdx] ?? null
  }

  setStateAsync(state: Partial<State>): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  getAttributes() {
    const result: { position?: number[]; scaling?: number[]; rotation?: number[] } = {}

    const a = this.attachment

    if (!a) {
      return result
    }

    if (!_.isEqual(this.state.position, a.position)) {
      result.position = a.position
    }
    if (!_.isEqual(this.state.scaling, a.scaling)) {
      result.scaling = a.scaling
    }
    if (!_.isEqual(this.state.rotation, a.rotation)) {
      result.rotation = a.rotation
    }

    return result
  }

  componentWillMount() {
    const s = this.getAttributes()

    if (!_.isEmpty(s)) {
      this.setState(s)
    }
  }

  updateVector(field: 'position' | 'rotation' | 'scaling', axis: number, value: number) {
    const values = [...this.state[field]]
    const n = field === 'scaling' ? limitNumber(value, -15, 15) : value
    if (field === 'scaling' && !this.state.expandScale) values.fill(n)
    else values[axis] = n
    this.setState({ [field]: values }, () => this.props.updateAttachment({ ...this.attachment!, [field]: values }))
  }

  render() {
    if (!this.attachment) return null
    return (
      <div class="costumer-wearable-editor">
        <dl class="props">
          {(['position', 'rotation', 'scaling'] as const).map((field) => (
            <>
              <dt>{field === 'scaling' ? 'Scale' : field === 'rotation' ? 'Rotation' : 'Position'}</dt>
              <dd class="vec3">
                {(field === 'scaling' && !this.state.expandScale ? [0] : [0, 1, 2]).map((axis) => (
                  <VectorField title={'XYZ'[axis]} value={this.state[field]?.[axis] ?? 0} setter={(value) => this.updateVector(field, axis, value)} step={field === 'rotation' ? 5 : 0.01} errorMessage={(error) => this.setState({ error })} />
                ))}
                {field === 'scaling' && <input type="checkbox" title="Keep aspect ratio" checked={!this.state.expandScale} onChange={() => this.setState({ expandScale: !this.state.expandScale })} />}
              </dd>
            </>
          ))}
        </dl>
        {this.state.error && <small role="alert">{this.state.error}</small>}
        <button class="danger" onClick={this.deleteAttachment}>
          Remove
        </button>
      </div>
    )
  }
}
