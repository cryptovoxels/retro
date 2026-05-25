import { render } from 'preact'
import { unmountComponentAtNode } from 'preact/compat'
import Feature from '../features/feature'
import { exitPointerLock, requestPointerLock } from '../../common/helpers/ui-helpers'
import { decodeCoords, encodeCoords } from '../../common/helpers/utils'
import ParcelHelper, { featurePlayCoordsFromRecord } from '../../common/helpers/parcel-helper'

export function inspectFeature(feature: Feature) {
  const div = document.createElement('div')
  div.className = 'inspect-feature pointer-lock-close overlay'
  document.body.appendChild(div)

  const ui = window.ui
  const connector = window.connector
  if (!ui) {
    return null
  }

  ui.activeTool = ui.featureTool // needed to make it unHighlight once closed
  ui.featureTool.highlightFeature(feature, feature.mesh as BABYLON.AbstractMesh | undefined)

  exitPointerLock()

  const isModerator = window.user.moderator

  const nearestEditableParcel = connector.nearestEditableParcel()
  const canNerf = nearestEditableParcel?.isExternalFeatureInParcel(feature)

  const close = () => {
    div && unmountComponentAtNode(div)
    div.remove()
    if (!document.querySelector('.overlay')) {
      window.ui?.deactivateToolsAndUnHighlightSelection()
      requestPointerLock()
    }
  }

  const toggleVisible = () => {
    if (feature.disposed) {
      feature.regenerate()
    } else {
      feature.dispose()
    }
  }

  const deleteFeature = () => {
    // Moderators might not have a nearest Editable parcel and since the server doesn't care about  the currentParcel when mods:
    const currentParcelId = nearestEditableParcel ? nearestEditableParcel.id : isModerator ? connector.nearestParcel()?.id : null

    if (!currentParcelId) {
      return
    }

    // Moderator by default
    const text = 'Are you sure you want to delete this feature?'
    if (confirm(text)) {
      connector.deleteFeature(feature.parcel.id, feature.uuid, currentParcelId)
      close()
    }
  }

  const isolate = () => {
    feature.deinstance()
    feature.parcel.voxelMesh?.dispose()
    feature.parcel.glassMesh?.dispose()
    feature.parcel.featuresList.forEach((f) => {
      if (f !== feature) {
        f.dispose()
      }
    })
    close()
  }

  const teleport = () => {
    const spawnURL = `/play?coords=${featurePlayCoordsFromRecord(new ParcelHelper(feature.parcel as any), { position: feature.tidyPosition, rotation: feature.tidyRotation })}`

    window.persona.teleport(spawnURL)
    close()
  }

  const viewSource = () => {
    const div = document.createElement('div')
    div.className = 'inspect-feature pointer-lock-close overlay view-source'
    const source = document.createElement('pre')
    const closeButton = document.createElement('button')
    closeButton.innerHTML = '&times;'
    closeButton.className = 'close'
    div.appendChild(closeButton)
    closeButton.onclick = () => {
      div.remove()
    }

    source.innerHTML = JSON.stringify(feature.description, null, 2)
    div.appendChild(source)
    document.body.appendChild(div)
  }

  const viewScript = () => {
    const div = document.createElement('div')
    div.className = 'inspect-feature pointer-lock-close overlay'
    const source = document.createElement('pre')
    const closeButton = document.createElement('button')
    closeButton.innerHTML = '&times;'
    closeButton.className = 'close'
    div.appendChild(closeButton)
    closeButton.onclick = () => {
      div.remove()
    }

    source.innerHTML = feature.description.script?.toString() || ''
    div.appendChild(source)
    document.body.appendChild(div)
  }
  // truncate string to be as long as an owner address
  const truncate = (str: string) => {
    return str.length <= 42 ? str : str.slice(0, 39) + '...'
  }

  const boundsState = feature.withinParcel ? '✅ Feature inside parcel' : feature.withinBounds ? '🌐 Within parcel extension tolerance' : '⚠️ Outside parcel bounds'

  const collidableMesh: BABYLON.AbstractMesh | undefined = feature.mesh as BABYLON.AbstractMesh
  // This as check a bit messy, bur works - on features that aren't of that type ".collidable" will return undefined and fail the check
  const collidableState = collidableMesh && collidableMesh.checkCollisions ? 'yes' : (feature.description as any).collidable ? 'disabled' : 'no'

  let instanceState: string
  if (feature.isAnInstance) {
    instanceState = `yes (${feature.getOtherInstances().length + 1} meshes)`
  } else if (feature.getOtherInstances().length > 0) {
    instanceState = `root (${feature.getOtherInstances().length + 1} meshes)`
  } else {
    instanceState = `no`
  }

  const externalLink = feature.isLink && !feature.isWorldLink ? feature.description.link : null
  let teleportLink = feature.isWorldLink && typeof feature.description.link === 'string' ? decodeCoords(feature.description.link) : null

  if (!teleportLink && feature.description.type === 'portal' && feature.description.womp) {
    teleportLink = decodeCoords(feature.description.womp.coords)
  }

  render(
    <div id="foo">
      <button className="close" onClick={() => close()}>
        &times;
      </button>

      <h3>Inspect Feature: {feature.type}</h3>
      <p>{boundsState}</p>
      <div class="feature-inspector-container">
        <table>
          <tbody>
            <tr>
              <th>UUID</th>
              <td>{feature.uuid}</td>
            </tr>
            <tr>
              <th>Collidable</th>
              <td>{collidableState}</td>
            </tr>
            <tr>
              <th>Instance</th>
              <td>{instanceState}</td>
            </tr>
            <tr>
              <th>Parcel</th>
              <td>
                <a href={`/parcels/${feature.parcel.id}`}>
                  #{feature.parcel.id} ({feature.parcel.name || feature.parcel.address})
                </a>
              </td>
            </tr>
            <tr>
              <th>Owner</th>
              <td>
                <a href={`/avatar/${feature.parcel.owner}`}>{feature.parcel.owner}</a>
              </td>
            </tr>
            {externalLink && (
              <tr>
                <th>External Link</th>
                <td>
                  <a title={externalLink} href={externalLink}>
                    {truncate(externalLink)}
                  </a>
                </td>
              </tr>
            )}
            {teleportLink && (
              <tr>
                <th>Teleport Link</th>
                <td>
                  <a title={encodeCoords(teleportLink)} href={`/play?coords=${encodeCoords(teleportLink)}`}>
                    {encodeCoords(teleportLink)}
                  </a>
                </td>
              </tr>
            )}
            {isModerator && feature.url && (
              <tr class="-moderatorOnly">
                <th>URL</th>
                <td>
                  <a title={feature.url} href={feature.url}>
                    {truncate(feature.url)}
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(canNerf || isModerator) && (
        <div class="feature-inspector-options -builder">
          <h4>Builder Actions</h4>
          <p>
            <small>This feature from another parcel overlaps your parcel. If this is unwanted, use the tools below</small>
          </p>
          <button onClick={deleteFeature}>Delete Feature</button>
        </div>
      )}

      {isModerator && (
        <div class="feature-inspector-options -moderator">
          <h4>Debug</h4>
          <button onClick={toggleVisible}>Toggle Visible</button>
          <button onClick={isolate}>Isolate</button>
          <button onClick={teleport}>Teleport</button>
          <button onClick={viewSource}>View Source</button>
          {feature.description.script && <button onClick={viewScript}>View Script</button>}
        </div>
      )}
    </div>,
    div,
  )
}
