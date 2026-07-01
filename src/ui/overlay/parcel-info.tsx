import { useEffect, useState } from 'preact/hooks'
import ParcelHelper from '../../../common/helpers/parcel-helper'
import ParcelEventItem from '../../../web/src/components/parcel-event'
import { app } from '../../../web/src/state'
import FavoriteButton from '../../../web/src/components/favorite-button'
import { isMobile } from '../../../common/helpers/detector'
import { toggleParcelAdminOverlay } from '../parcel-admin'
import { ParcelDetails } from '../../../web/src/components/parcels/parcel-details'
import LoadingIcon from '../../../web/src/components/loading-icon'
import { Womp, WompCard } from '../../../web/src/components/womp-card'
import cachedFetch from '../../../web/src/helpers/cached-fetch'
import { routeWithCoords } from '../../../web/src/helpers/coords-nav'
import { fetchOptions } from '../../../web/src/utils'
import { restoreInfoOnMove, uiPane } from '../../store'
import type Parcel from '../../parcel'
import { copyTextToClipboard } from '../../../common/helpers/utils'
import { PanelType } from '../../../web/src/components/panel'

// recent womps for this parcel, compact thumbnails above the details. clicking one keeps
// you in-world: clear the info pane and route (with coords) so it opens in the sidebar.
// "show more" just bumps the limit and refetches (the endpoint only takes a limit).
const WOMP_PAGE = 6

function RecentWomps({ parcelId }: { parcelId: number }) {
  const [womps, setWomps] = useState<Womp[]>([])
  const [limit, setLimit] = useState(WOMP_PAGE)

  useEffect(() => setLimit(WOMP_PAGE), [parcelId])

  useEffect(() => {
    let live = true
    cachedFetch(`/api/womps/at/parcel/${parcelId}.json?limit=${limit}`, fetchOptions(), 60)
      .then((r) => r.json())
      .then((r) => live && r.success && setWomps(r.womps))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [parcelId, limit])

  if (!womps.length) return null
  // a full page back means there are probably more to load
  const hasMore = womps.length >= limit
  return (
    <div className="overlay-parcel-info-content">
      <h4>Recent womps</h4>
      <div className="parcel-womps-grid">
        {womps.map((w) => (
          <WompCard
            key={w.id}
            womp={w}
            onClick={(womp) => {
              uiPane.value = undefined
              restoreInfoOnMove.value = true // walk away and the info pane comes back
              routeWithCoords(`/womps/${womp.id}`)
            }}
          />
        ))}
      </div>
      {hasMore && (
        <button type="button" class="womps-show-more" onClick={() => setLimit((n) => n + WOMP_PAGE)}>
          show more
        </button>
      )}
    </div>
  )
}

interface Props {
  parcel: Parcel | null
  scene: BABYLON.Scene
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
            {app.signedIn && !window.config.isSpace && (
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
          {!window.config.isSpace && (
            <li>
              <a onClick={() => toggleParcelAdminOverlay(parcel.summary, props.scene)} title="Admin panel">
                Admin
              </a>
            </li>
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
          {app.signedIn && !window.config.isSpace && (
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
          <div>
            <p>{description}</p>
          </div>
        </section>
        <div className="overlay-parcel-info-content">
          <h4>Event</h4>
          <ParcelEventItem parcel={parcel} noevent={true} showEventManager={true} />
        </div>
        <RecentWomps parcelId={parcel.id} />
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
