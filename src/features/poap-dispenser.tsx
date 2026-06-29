import { voxImporter } from '../../common/vox-import/vox-import'
import { Feature3D } from './feature'
import { Advanced, Animation, FeatureEditor, FeatureEditorProps, Toolbar } from '../ui/features'
import Panel from '../../web/src/components/panel'
import { PoapDispenserRecord } from '../../common/messages/feature'
import { FeatureTemplate } from './_metadata'
import { Position, Rotation, Scale, EditorProps } from '../../web/src/components/editor'

const params = {
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  credentials: 'include',
} as Record<string, Record<string, string> | string>

export default class PoapDispenser extends Feature3D<PoapDispenserRecord> {
  static template: FeatureTemplate = {
    type: 'poap-dispenser',
    scale: [1, 1, 1],
  }

  whatIsThis() {
    return <label>A POAP dispenser.</label>
  }

  async generate() {
    if (!this.description.animation) {
      this.description.animation = {
        destination: 'rotation',
        keyframes: [
          { frame: 0, value: [0, 0, 0] },
          { frame: 120, value: [0, 3.14, 0] },
          { frame: 360, value: [0, 3.14 * 2, 0] },
        ],
        easing: {},
      }
    }

    this.mesh = await voxImporter().import(process.env.ASSET_PATH + '/models/poap.vox', { signal: this.abortController.signal })
    this.mesh.isPickable = true
    this.mesh.name = this.uniqueEntityName('mesh')
    this.mesh.id = this.mesh.name

    this.setCommon()
    this.addAnimation()
  }

  dispose() {
    this._dispose()
  }

  toString() {
    return `[Achievement]`
  }
}

class Editor extends FeatureEditor<PoapDispenser> {
  constructor(props: FeatureEditorProps<PoapDispenser>) {
    super(props)

    this.state = {
      id: props.feature.description.id,
      event_id: props.feature.description.event_id,
      edit_code: props.feature.description.edit_code,
      // for UX purposes
      code: props.feature.description.edit_code,
      loading: false,
    }
  }

  componentDidUpdate(prevProps: FeatureEditorProps<PoapDispenser>, prevState: any) {
    this.merge({
      event_id: this.state.event_id,
    })

    if (prevState.edit_code != this.state.edit_code) {
      this.merge({ edit_code: this.state.edit_code })
    }
  }

  onSetPoapCode = async () => {
    if (!this.state.code) {
      this.setState({ edit_code: null })
      return
    }
    this.setState({ loading: true })
    const body = { code: this.state.code }
    // on set POAP code, encrypt it.
    let r: { success: boolean; encrypted?: string }
    try {
      const p = await fetch(`/api/poap/encrypt`, { method: 'POST', ...params, body: JSON.stringify(body) })
      r = await p.json()
    } catch {
      console.log('could not encrypt your code')
      this.setState({ loading: false })
      return
    }

    if (r && r.encrypted) {
      this.setState({ edit_code: r.encrypted, code: r.encrypted }, () => {
        this.merge({ edit_code: r.encrypted })
      })
    }
    this.setState({ loading: false })
  }

  render() {
    return (
      <section>
        <header>
          <h2>Edit Achievement</h2>
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
            {this.state.error && <Panel type="warning">{this.state.error}</Panel>}
            <Advanced>
              <div className="f">
                <label>Event ID</label>
                <input value={this.state.event_id} onInput={(e) => this.setState({ event_id: e.currentTarget.value })} type="text" />
                <small>As seen on the POAP's event page.</small>
              </div>

              <div className="f">
                <label>POAP Edit Code</label>
                <input value={this.state.code} disabled={this.state.loading || !!this.state.edit_code} onChange={(e) => this.setState({ code: e.currentTarget.value })} type="text" />
                <small>Secret code provided to the creator of the poap.</small>
                {!this.state.edit_code ? (
                  <button onClick={this.onSetPoapCode} disabled={this.state.loading}>
                    Save and encrypt
                  </button>
                ) : (
                  <button onClick={() => this.setState({ code: '', edit_code: null })} disabled={this.state.loading}>
                    Reset
                  </button>
                )}
              </div>
              <Animation feature={this.props.feature} />
            </Advanced>
          </EditorProps>
        </div>
      </section>
    )
  }
}

PoapDispenser.Editor = Editor
