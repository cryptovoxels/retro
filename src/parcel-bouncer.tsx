import { render, unmountComponentAtNode, useEffect, useState } from 'preact/compat'
import { cameraPosition } from './utils/camera'
import { fetchMetadataViaAlchemy } from '../common/helpers/apis'
import { exitPointerLock, requestPointerLockIfNoOverlays } from '../common/helpers/ui-helpers'
import { AlchemyNFTWithMetadata } from '../common/messages/api-alchemy'
import { tokensToEnter } from '../common/messages/parcel'
import LoadingIcon from '../web/src/components/loading-icon'
import Panel, { PanelType } from '../web/src/components/panel'
import { app } from '../web/src/state'
import type Parcel from './parcel'
import { distanceToAABB } from './utils/boundaries'
import { CloudMaterial } from './shaders/cloud'

enum NFTRequirementState {
  loading = 2,
  allowed = 1,
  notAllowed = 0,
}

const PARCEL_BOUNCE_MESH_NAME = 'mesh/parcel/box/noNFT'

const PARCEL_BOUNCER_MAX_VIEW_DISTANCE = 32

export default class ParcelBouncer {
  onNFTAuthChanged: BABYLON.Observable<void> = new BABYLON.Observable()
  time = 0.0
  private readonly _parcel: Parcel
  private _kickedUser = false
  private closeUI?: () => void
  private noEntryMesh: BABYLON.Mesh | undefined
  private isNoEntryMeshLoading = false

  constructor(parcel: Parcel) {
    this._parcel = parcel

    this._isUserAllowed = this.onlyTokenHoldersCanEnter ? NFTRequirementState.loading : NFTRequirementState.allowed

    this.getRejectedFromUrl()
  }

  private _isUserAllowed: NFTRequirementState

  get isUserAllowed(): NFTRequirementState {
    return this._isUserAllowed as NFTRequirementState
  }

  private set isUserAllowed(isAllowed: 1 | 2 | 0 | boolean) {
    if (typeof isAllowed == 'number') {
      this._isUserAllowed = isAllowed
    } else if (typeof isAllowed == 'boolean') {
      this._isUserAllowed = isAllowed ? 1 : 0
    }
  }

  get haskickedUser() {
    return this._kickedUser
  }

  private set haskickedUser(bool: boolean) {
    this._kickedUser = bool
  }

  get parcel() {
    return this._parcel
  }

  get scene() {
    return this.parcel.scene
  }

  get onlyTokenHoldersCanEnter() {
    return !!this.parcel.settings.tokensToEnter?.length
  }

  get userIsInside() {
    if (this.scene.activeCamera?.position) {
      return this.parcel.contains(cameraPosition(this.scene))
    }
    return false
  }

  init() {
    if (this.onNFTAuthChanged.hasObservers()) {
      return
    }
    this.onNFTAuthChanged.add(this.handleOnNFTAuthChanged)
  }

  dispose() {
    this.onNFTAuthChanged.removeCallback(this.handleOnNFTAuthChanged)
    this.haskickedUser = false
  }

  handleOnNFTAuthChanged = async () => {
    if (!this.onlyTokenHoldersCanEnter) {
      // The parcel is not private, do nothing
      return
    }
    console.log('generateNoEntryBox')
    if (this.isUserAllowed == NFTRequirementState.allowed) {
      // The user is allowed inside the parcel, remove the box Mesh
      this.removeNoEntryBoxMesh()
    } else if (this.isUserAllowed == NFTRequirementState.notAllowed) {
      // The user is not allowed inside the parcel, generate a box around the parcel
      this.generateNoEntryBoxMesh()
    }

    // User is inside the parcel and the UI is open
    if (this.isUserAllowed == NFTRequirementState.allowed) {
      if (this.userIsInside && this.closeUI) {
        // Close the UI
        app.showSnackbar('You are allowed to enter this parcel', PanelType.Success)
        this.closeUI()
      }
      this.resetUIFunctions()
    } else if (this.isUserAllowed == NFTRequirementState.notAllowed && this.userIsInside) {
      // kick the user because he's not allowed
      this.kickUser()
    }
  }

  async handleUser() {
    // Dont handle a non existant user in orbit mode
    if (window.config.isOrbit) return
    this.init()
    if (!this.onlyTokenHoldersCanEnter) {
      // The parcel is not private, do nothing
      return
    }

    if (this.isUserAllowed !== NFTRequirementState.allowed && this.noEntryMesh && this.userIsInside) {
      // The user is no allowed, the box outside the parcel is generated and the user is inside,
      // Highly likely the user is not allowed inside the parcel
      // kick the user
      this.kickUser()
      this.generateNoEntryBoxMesh()
      return
    }

    if (this.isUserAllowed !== NFTRequirementState.allowed) {
      // User is not allowed
      // regardless of whether user is inside our outside, generate the Box mesh
      this.generateNoEntryBoxMesh()
      // User is inside the parcel, show the UI that shows the conditions of entry
      if (this.userIsInside) {
        this.closeUI = await displayParcelNFTRequirementsOverlay(this)
      }
    } else {
      // User is allowed inside the parcel, close UI and destroy the Box mesh
      if (!!this.closeUI) {
        this.closeUI()
        this.closeUI = undefined
      }
      // There is a potential race condition here where the remove function might not do anything because we're still generating
      // the mesh of the box
      this.removeNoEntryBoxMesh()
    }
  }

  handleNFTAuth(userHasNFTNeededToEnter: boolean) {
    const value = userHasNFTNeededToEnter ? NFTRequirementState.allowed : NFTRequirementState.notAllowed
    if (this.isUserAllowed !== NFTRequirementState.loading && value == this.isUserAllowed) {
      return
    }

    // if user is not a moderator, an owner or a collaborator, they are subject to the nftAuth, else allow them.
    this.isUserAllowed = !this.parcel.socketAuth || this.parcel.socketAuth == 'Sandbox' ? value : NFTRequirementState.allowed
    this.onNFTAuthChanged.notifyObservers()
  }

  /**
   * This is only useful for showing the UI of the bouncer,
   * the user is already kicked out of the parcel if rejectedFrom is set.
   */
  private getRejectedFromUrl() {
    if (!this.onlyTokenHoldersCanEnter) {
      // no need to check if the parcel does not need any tokens to enter.
      return
    }

    if (!hasRejectedFromFlag()) {
      return
    }

    this._isUserAllowed = hasUserBeenRejected(this.parcel.id) ? 0 : 2 // NotAllowed or loading as starting states.
    if (!!hasUserBeenRejected(this.parcel.id)) {
      // loading state
      const searchParams = new URLSearchParams(document.location.search.substring(1))
      searchParams.delete('rejectedFrom')
      const stringified = searchParams.toString().replace('%40', '@').replace(/%2C/g, ',')
      history.replaceState({ rejectedFrom: null }, 'Cryptovoxels', '/play?' + stringified)

      this.haskickedUser = true // user was already kicked out at this point.
      displayParcelNFTRequirementsOverlay(this)
    }
  }

  private resetUIFunctions() {
    this.closeUI = undefined
  }

  private async kickUser() {
    // Three options for kicking the user:
    // 1. Kick user to nearest Streets
    // 2. Kick user to suburb center
    // 3. Straight up kick camera outside.

    let p
    try {
      p = await fetch(`${process.env.API}/parcels/${this.parcel.id}/closest/street.json`)
    } catch {}
    if (!p) {
      kickCameraOutsideParcel(this.parcel, this.scene)
      this.haskickedUser = true
      displayParcelNFTRequirementsOverlay(this)
      return
    }
    const r = await p.json()

    if (r.success) {
      const position = r.result.street || r.result.suburb
      const pos = new BABYLON.Vector3(position.coordinates[0] * 100, 1.5, position.coordinates[1] * 100)
      window.persona.teleportNoHistory({ position: pos, rotation: BABYLON.Vector3.Zero() })
    } else {
      kickCameraOutsideParcel(this.parcel, this.scene)
    }
    this.haskickedUser = true
    displayParcelNFTRequirementsOverlay(this)
  }

  /**
   * Generate a very low quality cube on the parcel
   */
  private generateNoEntryBoxMesh() {
    if (this.noEntryMesh || this.isNoEntryMeshLoading) {
      return
    }
    this.isNoEntryMeshLoading = true

    const bb = this.parcel.boundingBox
    const width = bb.maximum.x - bb.minimum.x + 0.2
    const height = bb.maximum.y - bb.minimum.y + 0.2
    const depth = bb.maximum.z - bb.minimum.z + 0.2

    const cube = BABYLON.MeshBuilder.CreateBox(
      PARCEL_BOUNCE_MESH_NAME,
      {
        width,
        depth,
        height,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      },
      this.scene,
    )
    cube.parent = this.parcel.transform
    cube.position.set(0.25, height / 2, 0.25) // nudge to fit parcel
    cube.checkCollisions = true
    BABYLON.Tags.AddTagsTo(cube, 'glow')

    cube.material = new CloudMaterial('blocked', this.scene)
    cube.isPickable = true

    /**
     * Allow clicking on the Box mesh.
     */
    cube.metadata = { isInteractive: true }
    cube.metadata.captureMoveEvents = true
    cube.enablePointerMoveEvents = true
    ;(cube as any).cvOnLeftClick = () => {
      exitPointerLock()
      displayParcelNFTRequirementsOverlay(this)
    }
    cube.material.alpha = 1
    // Add a bit of buffer to get a smooth transition
    cube.addLODLevel(PARCEL_BOUNCER_MAX_VIEW_DISTANCE + PARCEL_BOUNCER_MAX_VIEW_DISTANCE / 2, null)
    this.noEntryMesh = cube
    this.isNoEntryMeshLoading = false

    this.scene.onBeforeRenderObservable.add(this.updateMeshTransparency)
  }

  /**
   * Update the mesh transparency given the user's distance to parcel
   */
  private updateMeshTransparency = () => {
    if (!this.noEntryMesh || !this.noEntryMesh.material) {
      return
    }
    const pos = this.parcel.exteriorBounds
    const distance = distanceToAABB(cameraPosition(this.scene), pos)
    // Quadratic function;
    // >1 between 0 and 10, negative after PARCEL_BOUNCER_MAX_VIEW_DISTANCE.
    const opacity = distance > PARCEL_BOUNCER_MAX_VIEW_DISTANCE ? 0 : 1 + 0.01420455 * distance - 0.001420455 * distance ** 2
    this.noEntryMesh.material.alpha = Math.max(Math.min(opacity, 0.98), 0)
  }

  /**
   * Remove the parcel's `no ENtry` mesh
   */
  private removeNoEntryBoxMesh() {
    if (!this.noEntryMesh) {
      return
    }
    this.scene.onBeforeRenderObservable.removeCallback(this.updateMeshTransparency)
    this.noEntryMesh.dispose()
    this.noEntryMesh = undefined
  }
}

export async function displayParcelNFTRequirementsOverlay(bouncer: ParcelBouncer): Promise<() => void> {
  const div = document.createElement('div')
  const d = document.querySelector('.CheckUserIsAllowedInParcel')
  if (d) {
    unmountComponentAtNode(d)
    d.remove()
  }
  div.className = 'CheckUserIsAllowedInParcel pointer-lock-close'

  const closeUI = () => {
    onClose()
  }

  const onClose = () => {
    unmountComponentAtNode(div)
    div?.remove()
    requestPointerLockIfNoOverlays()
  }

  return new Promise(function (resolve) {
    const onRender = () => {
      resolve(closeUI)
    }

    document.body.appendChild(div)

    const state = bouncer.isUserAllowed as NFTRequirementState

    render(<DisplayParcelNFTRequirementsOverlay parcel={bouncer.parcel} state={state} onClose={onClose} />, div, onRender)
  })
}

function DisplayParcelNFTRequirementsOverlay({ parcel, state, onClose }: { parcel: Parcel; state?: NFTRequirementState; onClose: () => void }) {
  // isAllowed is a three-state machine: 2 = loading, 1 = allowed, 0 = Not allowed
  const [isAllowed, setIsAllowed] = useState<0 | 1 | 2>(state ?? 2)

  const onNFTAuthChanged = () => {
    setIsAllowed(parcel.parcelBouncer.isUserAllowed == 1 ? 1 : 0)
  }

  useEffect(() => {
    parcel.parcelBouncer.onNFTAuthChanged.add(onNFTAuthChanged)
    return () => {
      parcel.parcelBouncer.onNFTAuthChanged.removeCallback(onNFTAuthChanged)
    }
  }, [])

  const nfts = parcel.settings.tokensToEnter?.map((t) => <TokenToHave tokensToEnter={t} key={t.address + t.tokenId} />)

  return (
    <dialog className="-auto-height">
      <header>
        <h3>This parcel limits entry to NFT holders</h3>
        <button className="close" onClick={onClose}>
          &times;
        </button>
      </header>
      <section>
        {parcel.parcelBouncer.haskickedUser && <p>You have been kicked out of parcel {parcel.name || parcel.address}</p>}
        <b>Parcel information:</b>
        <ParcelThumb parcel={parcel} />
        <p>The owner of the parcel has decided that to enter this parcel you need to fill one of these conditions:</p>
        <ul>{nfts}</ul>
      </section>
      {isAllowed == 2 ? (
        <div className="Center">
          <LoadingIcon className="very-large" />
          Verifying your Wallet
        </div>
      ) : isAllowed == 1 ? (
        <Panel type="success"> You are allowed to enter this parcel!</Panel>
      ) : (
        <Panel type="danger"> You do not meet any of the conditions to enter this parcel</Panel>
      )}
    </dialog>
  )
}

const CV_ADDRESS = process.env.CONTRACT_ADDRESS
const NAME_ADDRESS = process.env.NAME_ADDRESS

function TokenToHave({ tokensToEnter }: { tokensToEnter: tokensToEnter }) {
  const [metadata, setMetadata] = useState<(AlchemyNFTWithMetadata & { success: boolean }) | null>(null)

  const getMetadata = async () => {
    const p = await fetchMetadataViaAlchemy(tokensToEnter)
    if (p?.success && p?.metadata) {
      setMetadata(p)
    }
  }

  useEffect(() => {
    tokensToEnter.tokenId && getMetadata()
  }, [])

  const website = () => {
    return metadata?.metadata.external_url || metadata?.metadata.url
  }

  const explorer = () => {
    if (tokensToEnter.chain == 1) {
      return `https://etherscan.io/address/${tokensToEnter.address}`
    } else {
      return `https://polygonscan.com/address/${tokensToEnter.address}`
    }
  }

  const opensea = () => {
    let path = 'https://opensea.io/assets/'
    path += tokensToEnter.chain == 1 ? 'ethereum/' : 'matic/'
    path += tokensToEnter.address
    path += tokensToEnter.tokenId ? `/${tokensToEnter.tokenId}` : ''
    return path
  }

  const name = () => {
    if (!tokensToEnter.tokenId) return ''
    return metadata?.metadata.name || `Token id ${tokensToEnter.tokenId.length > 8 ? tokensToEnter.tokenId?.substring(0, 8) + '...' : tokensToEnter.tokenId}`
  }

  const image = () => {
    let image = metadata?.metadata.image || metadata?.metadata.image_url || '/images/no-image.png'

    if (image.startsWith('ipfs://')) {
      const params = image.split('/')
      params.splice(0, 2)
      image = 'https://ipfs.io/ipfs/' + params.join('/')
    }
    return image
  }

  const isContractParcels = tokensToEnter.address.toLowerCase() == CV_ADDRESS?.toLowerCase()
  const isContractNames = tokensToEnter.address.toLowerCase() == NAME_ADDRESS?.toLowerCase()

  const NFTorParcel = isContractParcels ? 'Parcel' : isContractNames ? 'CV Name' : 'NFT'

  if (!tokensToEnter.tokenId) {
    return (
      <li className="tokensToEnter">
        <div>
          <b>Own</b>
          <img src="" width={32} />
          <div id="description">
            <b>Any {NFTorParcel}</b>
            <span>
              from {isContractParcels || isContractNames ? 'Cryptovoxels ' : 'collection '}
              <a href={explorer()} target="_blank">
                {tokensToEnter.address.substring(0, 8) + '...'}
              </a>
            </span>
          </div>
          <button
            onClick={() => {
              window.open(explorer(), '_blank')
            }}
            title="View on Explorer"
          >
            View on Explorer
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="tokensToEnter">
      <div>
        <b>Own</b>
        <img src={image()} width={32} />
        <div id="description">
          <b>"{name()}"</b>
          <span>
            {' '}
            from {isContractParcels || isContractNames ? 'Crytovoxels ' : 'collection '}
            <a href={explorer()} target="_blank">
              {tokensToEnter.address.substring(0, 8) + '...'}
            </a>
          </span>
        </div>
        <div id="actions">
          <button
            onClick={() => {
              window.open(website(), '_blank')
            }}
            title={!!website() ? `View on Website` : 'No Link found for this item'}
            disabled={!website()}
          >
            View item
          </button>
          <button
            onClick={() => {
              window.open(opensea())
            }}
          >
            View on OpenSea
          </button>
        </div>
      </div>
    </li>
  )
}

function kickCameraOutsideParcel(parcel: Parcel, scene: BABYLON.Scene) {
  const camera = scene.activeCamera
  if (!camera) {
    return
  }

  if (camera && !!parcel.parcelBouncer.userIsInside) {
    // Kick the user somewhere. Straight outside the parcel. THis means the user could also end up in someone else's parcel
    camera.position = new BABYLON.Vector3(parcel.x1 - 0.25, parcel.y1 + 0.75, parcel.z1 - 0.25)
  }
}

const ParcelThumb = (props: any) => {
  const parcelIdentifier = `${props.parcel.id}-${props.parcel.address.toLowerCase().replace(/\s+/g, '_')}`
  const name = props.parcel.name || props.parcel.address
  const address = (props.parcel.name ? [props.parcel.address, props.parcel.suburb] : [props.parcel.suburb]).join(', ')

  const description = props.parcel.description?.length > 128 ? props.parcel.description.substring(0, 128) + '...' : props.parcel.description

  return (
    <div style={{ display: 'flex', padding: '3px', margin: '2px' }}>
      <img src={`https://map.voxels.com/parcel/${parcelIdentifier}.png`} width={50} style={{ margin: '2px' }} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <a href={`/parcels/${props.parcel.id}`}>{name}</a>
        <p>{address}</p>
        <p>{description}</p>
      </div>
    </div>
  )
}

const hasRejectedFromFlag = () => {
  const params = new URLSearchParams(document.location.search.substring(1))
  return !!params.get('rejectedFrom')
}

const hasUserBeenRejected = (id: number): null | boolean => {
  const params = new URLSearchParams(document.location.search.substring(1))
  return params.get('rejectedFrom') == id.toString()
}
