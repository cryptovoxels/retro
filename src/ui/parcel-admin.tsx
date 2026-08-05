import { Component, render } from 'preact'
import { unmountComponentAtNode } from 'preact/compat'
import { exitPointerLock, requestPointerLockIfNoOverlays } from '../../common/helpers/ui-helpers'
import { ParcelRecord } from '../../common/messages/parcel'

interface Props {
  parcel: ParcelRecord
  onClose?: () => void
  scene: BABYLON.Scene
}

export class ParcelAdminOverlay extends Component<Props> {
  static currentElement: Element

  close = () => {
    this.props.onClose && this.props.onClose()
  }

  closeWithPointerLock = () => {
    this.close()
    requestPointerLockIfNoOverlays()
  }

  render() {
    const p = this.props.parcel
    return (
      <dialog className="-auto-height ParcelAdminWindow">
        <h3>Parcel Admin</h3>

        <section class="SplitPanel">
          <div className="Panel">
            <div className="OverlayHighlightContent">
              <h4>Name</h4>
              <p>{p.name}</p>
            </div>
            <div className="OverlayHighlightContent">
              <h4>Description</h4>
              <p>{p.description}</p>
            </div>
          </div>
          <div className="Panel">
            <div className="OverlayHighlightContent">
              <a href={`/parcels/${(p as any).id}/edit`} target="_blank" rel="noreferrer">
                Edit on web
              </a>
            </div>
            <div className="OverlayHighlightContent">
              <h4>Event Management</h4>
              <a href={`/events/new?parcel_id=${(p as any).id}`}>Create event</a>
            </div>
          </div>
        </section>
      </dialog>
    )
  }
}

export function toggleParcelAdminOverlay(parcel: ParcelRecord, scene: BABYLON.Scene, onClose?: () => void) {
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
