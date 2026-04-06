import { Component, render } from 'preact'
import { unmountComponentAtNode } from 'preact/compat'
import ParcelHelper, { ParcelUser } from '../../common/helpers/parcel-helper'
import { exitPointerLock, requestPointerLockIfNoOverlays } from '../../common/helpers/ui-helpers'
import { ParcelRecord } from '../../common/messages/parcel'
import { AssetType } from '../../web/src/components/Editable/editable'
import Panel, { PanelType } from '../../web/src/components/panel'
import { saveAsset } from '../../web/src/helpers/save-helper'
import { toggleEventManagerWindow } from '../../web/src/popup-ui/event-manager'
import { app, AppEvent } from '../../web/src/state'
import type { Scene } from '../scene'

// Properties of a parcel required by this control
interface Props {
  parcel: ParcelRecord
  onClose?: () => void
  scene: Scene
}

interface State {
  signedIn?: boolean
  saving: boolean
  panel?: string
  success: boolean
  /*Parcel info */
  name: string | null
  description: string | null
  parcelUsers: ParcelUser[] | null
  hosted_scripts?: boolean
  sandbox?: boolean
}

export class ParcelAdminOverlay extends Component<Props, State> {
  static currentElement: Element
  interval: number = undefined!

  constructor(props: Props) {
    super(props)

    this.state = {
      signedIn: app.signedIn,
      saving: false,
      panel: null!,
      success: false,
      /* Load initial configs */
      name: props.parcel.name,
      description: props.parcel.description,
      parcelUsers: props.parcel.parcel_users || [],
      hosted_scripts: !!props.parcel.settings.hosted_scripts,
      sandbox: props.parcel.settings.sandbox === true,
    }
  }

  get parcel() {
    return this.props.parcel
  }

  get helper() {
    if (!this.props.parcel) {
      return null
    }
    return new ParcelHelper(this.props.parcel)
  }

  get isOwner(): boolean {
    if (!app.signedIn) {
      return false
    }

    return !!this.helper?.isOwner(app.state.wallet)
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
  }

  onAppChange = () => {
    const { signedIn } = app

    this.setState({ signedIn })
  }

  componentDidUpdate(prevProps: Props) {
    // If we got a new parcel props.
    if (prevProps.parcel !== this.props.parcel) {
      this.forceUpdate()
    }
  }

  componentWillUnmount() {
    app.removeListener('change', this.onAppChange)
  }

  close = () => {
    this.props.onClose && this.props.onClose()
  }

  closeWithPointerLock = () => {
    this.close()
    requestPointerLockIfNoOverlays()
  }

  async saveName() {
    if (!this.isOwner) {
      return
    }
    this.setState({ saving: true }, async () => {
      const r = await saveAsset(AssetType.Parcel, this.props.parcel.id, { name: this.state.name })
      this.setState({ saving: false })
      if (r.success) {
        this.props.parcel.name = this.state.name
      }
      this.setPanel(r.success ? 'New name was saved!' : 'Something went wrong, please try again...', r.success)
    })
  }

  async saveDescription() {
    if (!this.isOwner) {
      return
    }
    this.setState({ saving: true }, async () => {
      const r = await saveAsset(AssetType.Parcel, this.props.parcel.id, { description: this.state.description })
      this.setState({ saving: false })
      if (r.success) {
        this.props.parcel.description = this.state.description
      }
      this.setPanel(r.success ? 'New description was saved!' : 'Something went wrong, please try again...', r.success)
    })
  }

  async saveSettings(dict: Partial<State>) {
    if (!this.isOwner) {
      return
    }
    this.setState({ saving: true, ...dict }, async () => {
      const r = await saveAsset(AssetType.Parcel, this.props.parcel.id, dict)
      this.setState({ saving: false })
      this.props.parcel.settings = Object.assign(this.props.parcel.settings, dict)
      this.setPanel(r.success ? 'Setting saved!' : 'Something went wrong, please try again...', r.success)
    })
  }

  setPanel(message: string, success = false) {
    this.setState({ panel: message, success }, () => {
      setTimeout(() => {
        this.setState({ panel: null!, success: false })
      }, 4000)
    })
  }

  render() {
    return (
      <div className="OverlayWindow -auto-height ParcelAdminWindow">
        <header>
          <h3>Parcel Admin</h3>
        </header>
        {this.state.saving && <Panel type={PanelType.Info}>Saving...</Panel>}
        {!this.state.saving && this.state.panel && <Panel type={this.state.success ? PanelType.Success : PanelType.Danger}>{this.state.panel}</Panel>}

        <section class="SplitPanel">
          <div className="Panel">
            <div className="OverlayHighlightContent">
              <h4>Name</h4>
              <div className="FlexInput">
                <input type="text" disabled={!this.isOwner} value={this.state.name!} onInput={(e) => this.setState({ name: (e as any).target['value'] })} />
                <button disabled={this.state.saving || !this.isOwner} onClick={() => this.saveName()} style={this.state.name === this.props.parcel.name && ({ visibility: 'hidden' } as any)}>
                  Save
                </button>
              </div>
            </div>
            <div className="OverlayHighlightContent">
              <h4>Description</h4>
              <div className="FlexInput">
                <textarea rows={3} value={this.state.description || ''} disabled={!this.isOwner} onInput={(e) => this.setState({ description: (e as any).target['value'] })} />
                <button disabled={this.state.saving || !this.isOwner} onClick={() => this.saveDescription()} style={this.state.description === this.props.parcel.description && ({ visibility: 'hidden' } as any)}>
                  Save
                </button>
              </div>
            </div>
          </div>
          <div className="Panel">
            <div className="OverlayHighlightContent">
              <h4>Settings</h4>
              <ul style={{ listStyle: 'none' }}>
                <li>
                  <label>
                    <input name="onGrid" type="checkbox" title="Toggle hosted scripts." onChange={(e) => this.saveSettings({ hosted_scripts: (e as any).target['checked'] })} checked={this.state.hosted_scripts} />
                    Hosted Scripts
                  </label>
                  <small> (Makes your scripts multiplayer)</small>
                </li>
                <li>
                  <label>
                    <input name="sandbox" type="checkbox" title="Make sandbox public editable" onChange={(e) => this.saveSettings({ sandbox: (e as any).target['checked'] })} checked={this.state.sandbox} />
                    Is Sandbox
                  </label>
                  <small> (Makes your parcel editable for everyone)</small>
                </li>
              </ul>
            </div>
            <div className="OverlayHighlightContent">
              <h4>Event Management</h4>
              <button onClick={() => toggleEventManagerWindow(this.parcel)}>Create/Edit parcel event</button>
            </div>
          </div>
        </section>
      </div>
    )
  }
}

export function toggleParcelAdminOverlay(parcel: ParcelRecord, scene: Scene, onClose?: () => void) {
  if (ParcelAdminOverlay.currentElement?.parentElement) {
    unmountComponentAtNode(ParcelAdminOverlay.currentElement)
    ParcelAdminOverlay.currentElement = null!
  } else {
    const div = document.createElement('div')
    div.className = 'pointer-lock-close'
    document.body.appendChild(div)
    ParcelAdminOverlay.currentElement = div

    render(
      <ParcelAdminOverlay
        parcel={parcel}
        onClose={() => {
          !!ParcelAdminOverlay.currentElement && unmountComponentAtNode(ParcelAdminOverlay.currentElement)
          ParcelAdminOverlay.currentElement = null!
          onClose && onClose()
          div.remove()
        }}
        scene={scene}
      />,
      div,
    )

    exitPointerLock()
  }
}
