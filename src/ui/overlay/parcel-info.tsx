import ParcelHelper from '../../../common/helpers/parcel-helper'
import Emojis from '../../../web/src/components/emoji-badges'
import ParcelEventItem from '../../../web/src/components/parcel-event'
import WriteMailOverlay from '../mail-owner'
import { app } from '../../../web/src/state'
import FavoriteButton from '../../../web/src/components/favorite-button'
import { isMobile } from '../../../common/helpers/detector'
import { toggleParcelAdminOverlay } from '../parcel-admin'
import { ParcelDetails } from '../../../web/src/components/parcels/parcel-details'
import { OwnerAndCollaboratorOnly, SignedInOnly } from '../../../web/src/components/parcels/permissions'
import LoadingIcon from '../../../web/src/components/loading-icon'
import type Parcel from '../../parcel'
import { copyTextToClipboard } from '../../../common/helpers/utils'
import type { Scene } from '../../scene'
import { PanelType } from '../../../web/src/components/panel'

interface Props {
  parcel: Parcel | null
  scene: Scene
}

export default function ParcelInfoTab(props: Props) {
  const parcel = props.parcel

  if (!parcel) {
    return (
      <section className="parcel-information-overlay">
        <header>
          <h2>{`Loading...`}</h2>
        </header>
        <div className="scrollContainer">
          <div className="parcels-details">
            <h2>
              <span></span>
            </h2>
          </div>
          <section className="overlay-parcel-info-content">
            <div className="Center">
              <LoadingIcon className="very-large" />
            </div>
          </section>
        </div>
      </section>
    )
  }

  const helper = new ParcelHelper(parcel)

  const name = parcel.name
  const address = parcel.address
  const description = parcel.description
  const suburbSlug = parcel.suburb.toLowerCase().replace(/\s+/, '-')
  const islandSlug = parcel.island.toLowerCase().replace(/\s+/, '-')

  const scores = parcel.performanceScores()

  const copyParcelLinkToClipboard = () => {
    copyTextToClipboard(
      `${process.env.ASSET_PATH}/parcels/${parcel.id}/visit`,
      () => {
        app.showSnackbar('Link copied to clipboard', PanelType.Success)
      },
      () => {
        app.showSnackbar('Failed to copy link', PanelType.Danger)
      },
    )
  }
  const mailOwner = (
    <SignedInOnly>
      <a
        onClick={() => {
          WriteMailOverlay(parcel)
        }}
        title="Mail parcel owner"
      >
        ✉️ Mail parcel owner
      </a>
    </SignedInOnly>
  )

  // On mobile, the scrollContainer doesn't scroll. I couldn't figure out how to fix it,
  // So we render a component dedicated to mobile (smaller)
  if (isMobile()) {
    return (
      <section className="parcel-information-overlay">
        <header>
          <h2>{`${name || address}`}</h2>
        </header>
        <div className="scrollContainer">
          <div className="parcels-details">
            <h2>
              {name ? `At ${address}, near` : 'Near'}&nbsp;
              <span>
                <a href={`/neighborhoods/${suburbSlug}`}>{parcel.suburb}</a> in <a href={`/islands/${islandSlug}`}>{parcel.island}</a>
              </span>
            </h2>
          </div>
          <ul className="actions">
            {!props.scene.config.isSpace && (
              <OwnerAndCollaboratorOnly parcel={parcel}>
                <li>
                  <a onClick={() => toggleParcelAdminOverlay(parcel.summary, props.scene)} title="Admin panel">
                    Admin
                  </a>
                </li>
              </OwnerAndCollaboratorOnly>
            )}
            <li>
              <a target="_top" href={`/parcels/${parcel.id}`}>
                Parcel page
              </a>
            </li>
            <li>
              <a href={helper.openseaUrl} target="_blank">
                OpenSea
              </a>
            </li>
            {app.signedIn && !props.scene.config.isSpace && (
              <li>
                <FavoriteButton parcelId={parcel.id} />
              </li>
            )}
            <li>
              <a title="Share parcel visit link" href="#" onClick={copyParcelLinkToClipboard}>
                Share
              </a>
            </li>
          </ul>
          <section className="overlay-parcel-info-content">
            <div className="is-flex">
              <div>
                Owner:{' '}
                <span>
                  <a title="See avatar page" href={`/avatar/${parcel.owner}`}>
                    {helper.ownerName}
                  </a>
                </span>
              </div>
              {mailOwner}
            </div>
            <div className="overlay-parcel-info-content">
              <h4>Event</h4>
              <ParcelEventItem parcel={parcel} noevent={true} />
            </div>
          </section>
        </div>
      </section>
    )
  }

  // is not mobile

  return (
    <section className="parcel-information-overlay">
      <header>
        <h2>{`${name || address}`}</h2>
      </header>
      <div className="scrollContainer">
        <div className="parcels-details">
          <h2>
            {name ? `At ${address}, near` : 'Near'}&nbsp;
            <span>
              <a href={`/neighborhoods/${suburbSlug}`}>{parcel.suburb}</a> in <a href={`/islands/${islandSlug}`}>{parcel.island}</a>
            </span>
          </h2>
        </div>
        <ul className="actions">
          {!props.scene.config.isSpace && (
            <OwnerAndCollaboratorOnly parcel={parcel}>
              <li>
                <a onClick={() => toggleParcelAdminOverlay(parcel.summary, props.scene)} title="Admin panel">
                  Admin
                </a>
              </li>
            </OwnerAndCollaboratorOnly>
          )}
          <li>
            <a target="_top" href={`/parcels/${parcel.id}`}>
              Parcel page
            </a>
          </li>
          <li>
            <a href={helper.openseaUrl} target="_blank">
              OpenSea
            </a>
          </li>
          {app.signedIn && !props.scene.config.isSpace && (
            <li>
              <FavoriteButton parcelId={parcel.id} />
            </li>
          )}
          <li>
            <a title="Share parcel visit link" href="#" onClick={copyParcelLinkToClipboard}>
              Share
            </a>
          </li>
        </ul>
        <section className="overlay-parcel-info-content">
          {!props.scene.config.isSpace && (
            <div>
              <Emojis item={parcel} emojiable_type="parcels" />
            </div>
          )}
          <div>
            <p>{description}</p>
          </div>
          <div className="is-flex">{mailOwner}</div>
        </section>
        <div className="overlay-parcel-info-content">
          <h4>Event</h4>
          <ParcelEventItem parcel={parcel} noevent={true} showEventManager={true} />
        </div>
        <div className="overlay-parcel-info-content">
          <ParcelDetails parcel={parcel.summary} />
        </div>

        <section className="overlay-parcel-info-content">
          <div className="ParcelDetailsComponent">
            <h4>3D performance</h4>
            <dl class="deets">
              <dt title="# of voxels and features 3D triangles">Triangles</dt>
              <dd>{scores.triangles.toLocaleString()}</dd>
              <dt title="# of features that are animated">Animated</dt>
              <dd>{scores.animated.toLocaleString()}</dd>
              <dt title="# of features that are collidable">Collidable</dt>
              <dd>{scores.collidables.toLocaleString()}</dd>
              <dt title="# of groups">Groups</dt>
              <dd>{scores.groups.toLocaleString()}</dd>
              <dt title="# of features, loaded vs total">Features</dt>
              <dd>
                {scores.features.active} / {scores.features.total}
              </dd>
            </dl>
          </div>
        </section>
      </div>
    </section>
  )
}
