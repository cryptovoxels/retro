import { render } from 'preact-render-to-string'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { copyTextToClipboard, encodeCoords } from '../../common/helpers/utils'
import { MapParcelRecord } from '../../common/messages/api-parcels'
import type { ParcelData, VoxelsMap } from './helpers/load-voxels-map'
import { PanelType } from './components/panel'
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
