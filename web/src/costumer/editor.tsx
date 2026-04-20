import { Component } from 'preact'
import * as _ from 'lodash'
import { sortBy } from 'lodash'
import { Costume, CostumeAttachment } from '../../../common/messages/costumes'
import { pending } from './utils'

interface Props {
  attachmentIdx: number
  updateAttachment: (a: CostumeAttachment) => void
  deleteAttachment: (attachmentIdx: number) => void
  costume: Costume | null
}

interface State {
  position: number[]
  scaling: number[]
  rotation: number[]
  expandScale: boolean
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

  setAttachmentBone = async (name: string) => {
    this.merge({ bone: name }).catch(console.error)
  }

  suppress = (e: Event) => {
    const target = e.target as HTMLElement | null

    if (target && target.nodeName == 'INPUT') {
      target.focus()
      // allow
    } else {
      e.preventDefault()
    }
  }

  get attachment(): CostumeAttachment | null {
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

  num(value: string): number | null {
    const parsedValue = parseFloat(value)
    return parsedValue.toString() === value.toString() ? parsedValue : null
  }

  async updatePosition(key: number, value: string) {
    const parsedValue = this.num(value)
    if (parsedValue === null) {
      return
    }
    const position = this.state.position
    position[key] = parsedValue
    await this.setStateAsync({ position })
    this.sendUpdates()
  }

  async updateRotation(key: number, value: string) {
    const parsedValue = this.num(value)
    if (parsedValue === null) {
      return
    }
    const rotation = this.state.rotation
    rotation[key] = parsedValue
    await this.setStateAsync({ rotation })
    this.sendUpdates()
  }

  async updateScales(value: string) {
    const parsedValue = this.num(value)
    if (parsedValue === null) {
      return
    }
    const limit = 15
    const n = limitNumber(parsedValue, -limit, limit)

    const scaling = this.state.scaling
    scaling[0] = n
    scaling[1] = n
    scaling[2] = n
    await this.setStateAsync({ scaling })
    this.sendUpdates()
  }

  async updateScale(key: number, value: string) {
    const parsedValue = this.num(value)
    if (parsedValue === null) {
      return
    }
    const scaling = this.state.scaling
    const limit = 15
    scaling[key] = limitNumber(parsedValue, -limit, limit)
    await this.setStateAsync({ scaling })
    this.sendUpdates()
  }

  sendUpdates() {
    const attachment: Partial<CostumeAttachment> = {}
    attachment.position = this.state.position
    attachment.rotation = this.state.rotation
    attachment.scaling = this.state.scaling
    this.merge(attachment).catch(console.error)
  }

  async merge(params: Partial<CostumeAttachment>) {
    const attachment = Object.assign({}, this.attachment, params)
    this.props.updateAttachment(attachment)
  }

  render() {
    const posStep = 0.01
    const step = 0.05

    const boneName = (b: BABYLON.Bone) => b.name.split(/:/)[1]

    const attachment = this.attachment

    // @ts-expect-error global abuse todo stop passing this via window
    const skeleton: BABYLON.Skeleton | null = window['skeleton']

    if (!this.attachment || !skeleton) {
      return <div />
    }

    let bones = skeleton?.bones.filter((b) => !RegExp(/index/i).exec(b.name))
    bones = sortBy(bones, (b: BABYLON.Bone) => {
      // Sort by vertical position, left side first
      return -b.getPosition(BABYLON.Space.WORLD).y + (RegExp(/left/i).exec(b.name) ? -0.01 : 0.01)
    })

    return (
      <div onWheel={this.suppress} class="costumer-wearable-editor">
        <div class="editor-field position">
          <label for="position[x]">Position</label>
          <div class="fields">
            <input
              id="position[x]"
              type="number"
              step={posStep}
              accessKey="x"
              title="x"
              value={this.state?.position?.[0]}
              onInput={(e) => this.updatePosition(0, e.currentTarget['value'])}
              onChange={(e) => this.updatePosition(0, e.currentTarget['value'])}
            />
            <input
              id="position[y]"
              type="number"
              step={posStep}
              accessKey="y"
              title="y"
              value={this.state?.position?.[1]}
              onInput={(e) => this.updatePosition(1, e.currentTarget['value'])}
              onChange={(e) => this.updatePosition(1, e.currentTarget['value'])}
            />
            <input
              id="position[z]"
              type="number"
              step={posStep}
              accessKey="z"
              title="z"
              value={this.state?.position?.[2]}
              onInput={(e) => this.updatePosition(2, e.currentTarget['value'])}
              onChange={(e) => this.updatePosition(2, e.currentTarget['value'])}
            />
          </div>
        </div>
        <div class="editor-field rotation">
          <label for="rotation[x]">Rotation</label>
          <div class="fields">
            <input
              id="rotation[x]"
              type="number"
              step={5}
              accessKey="r"
              title="x"
              value={this.state?.rotation?.[0]}
              onInput={(e) => this.updateRotation(0, e.currentTarget['value'])}
              onChange={(e) => this.updateRotation(0, e.currentTarget['value'])}
            />
            <input id="rotation[y]" type="number" step={5} title="y" value={this.state?.rotation?.[1]} onInput={(e) => this.updateRotation(1, e.currentTarget['value'])} onChange={(e) => this.updateRotation(1, e.currentTarget['value'])} />
            <input id="rotation[z]" type="number" step={5} title="z" value={this.state?.rotation?.[2]} onInput={(e) => this.updateRotation(2, e.currentTarget['value'])} onChange={(e) => this.updateRotation(2, e.currentTarget['value'])} />
          </div>
        </div>

        {this.state.expandScale ? (
          <div class="editor-field scale">
            <label for="scale[x]">Scale</label>
            <div class="fields">
              <input
                id="scale[x]"
                type="number"
                step={step}
                accessKey="s"
                title="x"
                value={this.state?.scaling?.[0]}
                onInput={(e) => this.updateScale(0, e.currentTarget['value'])}
                onChange={(e) => this.updateScale(0, e.currentTarget['value'])}
              />
              <input id="scale[y]" type="number" step={step} title="y" value={this.state?.scaling?.[1]} onInput={(e) => this.updateScale(1, e.currentTarget['value'])} onChange={(e) => this.updateScale(1, e.currentTarget['value'])} />
              <input id="scale[z]" type="number" step={step} title="z" value={this.state?.scaling?.[2]} onInput={(e) => this.updateScale(2, e.currentTarget['value'])} onChange={(e) => this.updateScale(2, e.currentTarget['value'])} />
              <button class="toggle" onClick={() => this.setState({ expandScale: false })}>
                ...
              </button>
            </div>
          </div>
        ) : (
          <div class="editor-field scale-all">
            <label for="scale">Scale</label>
            <div class="fields">
              <input
                id="scale"
                type="number"
                step={0.01}
                accessKey="s"
                title="all"
                value={this.state?.scaling?.[0]}
                onInput={(e) => this.updateScales(e.currentTarget['value'])}
                onChange={(e) => this.updateScales(e.currentTarget['value'])}
              />
              <button class="toggle" onClick={() => this.setState({ expandScale: true })}>
                ...
              </button>
            </div>
          </div>
        )}

        <div class="action">
          <button class="danger" onClick={(e) => this.deleteAttachment(e)}>
            Remove
          </button>
        </div>
      </div>
    )
  }
}
