import { render } from 'preact-render-to-string'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { copyTextToClipboard, encodeCoords } from '../../common/helpers/utils'
import { MapParcelRecord } from '../../common/messages/api-parcels'
import type { ParcelData, VoxelsMap } from './helpers/load-voxels-map'
import { PanelType } from './components/panel'
import ParcelEvent from './helpers/event'
import { app } from './state'
import { AvatarLink } from './components/avatar-link'

const copyToClipboard = (playCoords: string | null) => {
  if (!playCoords) return
  copyTextToClipboard(
    playCoords,
    () => {
      app.showSnackbar('Copied!', PanelType.Success)
    },
    () => {
      app.showSnackbar('Try again', PanelType.Warning)
    },
  )
}

export function mapParcelPopup(map: VoxelsMap, x: number, z: number, parcel: MapParcelRecord | ParcelData, openSpawnUrl: (url: string) => void) {
  const div = document.createElement('div')
  div.className = 'map-teleport-popup'

  const helper = new ParcelHelper(parcel as any)

  div.innerHTML = render(
    <article class="component">
      <strong>
        <a href={`/parcels/${parcel.id}`}>{parcel.name || parcel.address}</a>
      </strong>
      <div>{parcel.name ? parcel.address : parcel.suburb}</div>
    </article>,
  )

  map.openPopup(x, z, div)
}

export function mapTeleportPopup(map: VoxelsMap, x: number, z: number, openSpawnUrl: (url: string) => void) {
  const div = document.createElement('div')
  div.className = 'map-teleport-popup'

  const coords = {
    position: BABYLON.Vector3.FromArray([x, 2.5, z]),
    rotation: BABYLON.Vector3.Zero(),
    flying: true,
  }

  const encoded = encodeCoords(coords)
  div.innerHTML = render(<div id="popup-buttonContainer" role="group"></div>)

  const buttonContainer = div.querySelector('#popup-buttonContainer')!
  const teleportHereBtn = document.createElement('button')
  teleportHereBtn.className = 'teleportHere'
  teleportHereBtn.textContent = 'Teleport here'
  teleportHereBtn.onclick = () => {
    openSpawnUrl(`/play?coords=${encoded}`)
    map.closePopup()
  }
  buttonContainer.appendChild(teleportHereBtn)

  const copyCoordsLinkBtn = document.createElement('button')
  copyCoordsLinkBtn.className = 'teleportHere'
  copyCoordsLinkBtn.textContent = 'Copy Coordinates'
  copyCoordsLinkBtn.onclick = () => {
    copyTextToClipboard(
      `${process.env.ASSET_PATH}/play?coords=${encoded}`,
      () => {
        app.showSnackbar('Copied!', PanelType.Success)
      },
      () => {
        app.showSnackbar('Try again', PanelType.Warning)
      },
    )

    map.closePopup()
  }
  buttonContainer.appendChild(copyCoordsLinkBtn)
  map.openPopup(x, z, div)
}

export function mapEventMarkerPopup(event: ParcelEvent, openSpawnUrl: (url: string | null) => void): HTMLElement {
  const div = document.createElement('div')
  div.className = 'map-teleport-popup'

  div.innerHTML = render(
    <div>
      <h2>
        {'Event live now '} at {event.parcel_address}
      </h2>

      <br />

      <strong>
        <a href={`/events/${event.id}`}>{event.name}</a>
      </strong>

      <br />

      <div>
        Hosted by{' '}
        <a href={`/u/${event.author}`} target="_blank">
          {event.authorNameOrAddress(10)}
        </a>
      </div>
      <br />
      <div id="popup-buttonContainer" style={{ textAlign: 'center' }}></div>
    </div>,
  )

  const buttonContainer = div.querySelector('#popup-buttonContainer')!

  const button = document.createElement('button')
  button.className = 'teleportHere'
  button.textContent = 'Visit now'
  button.onclick = () => {
    button.textContent = 'Loading...'
    button.disabled = true
    event.getTeleportString().then(openSpawnUrl)
  }

  buttonContainer.appendChild(button)

  const button2 = document.createElement('button')
  button2.className = 'copyCoordinates'
  button2.textContent = 'Copy link to event'
  button2.onclick = () => {
    button2.textContent = 'Loading...'
    button2.disabled = true
    event.getTeleportString().then(copyToClipboard)
  }
  buttonContainer.appendChild(button2)

  return div
}
