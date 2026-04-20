import * as ethers from 'ethers'
import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { format } from 'timeago.js'
import { fetchUsersCollectibles } from '../../../../common/helpers/collections-helpers'
import ParcelHelper from '../../../../common/helpers/parcel-helper'
import { copyTextToClipboard } from '../../../../common/helpers/utils'
import { ApiAvatar } from '../../../../common/messages/api-avatars'
import { ParcelRecord } from '../../../../common/messages/parcel'
import cachedFetch from '../../helpers/cached-fetch'
import { AssetType } from '../../helpers/save-helper'
import { Client } from '../../parcel'
import ClientBar from '../client-bar'
import { app } from '../../state'
import { fetchAPI } from '../../utils'
import EditableDescription from '../Editable/editable-description'
import { PanelType } from '../panel'
import { EditSocialLink, SocialLink } from './socials'
// import AvatarCanvas from '../../../../src/ui/costumers/avatar-canvas'
import { ethTrunc } from '../../../../common/utils'
import { Contributor } from '../../../account/contributor'
import { Parcels } from '../../../account/parcels'
import { Spaces } from '../../../account/spaces'
import WompsList from '../../womps-list'
import { Costume } from '../../../../common/types'
// import Collectibles from '../../../account/collectibles'

type Props = {
  walletOrUUId: string
  tab?: string
  isOwner?: boolean
}

export default function Profile(props: Props) {
  const [avatar, setAvatar] = useState<ApiAvatar | undefined>(undefined)
  const [collabs, setCollabs] = useState(0)
  const [wearables, setWearables] = useState(0)
  const [costumes, setCostumes] = useState<Costume[]>([])
  const [womps, setWomps] = useState(0)
  const [homeParcel, setHomeParcel] = useState<ParcelRecord | null>(null)
  const [showHomeSearch, setShowHomeSearch] = useState(false)
  const [parcelOptions, setParcelOptions] = useState<{ id: number; label: string }[]>([])
  const homeSearchRef = useRef<HTMLInputElement>(null)
  const { walletOrUUId } = props

  useEffect(() => fetch(), [walletOrUUId])

  useEffect(() => {
    if (!props.isOwner) return
    let lastCoords = ''
    const interval = setInterval(() => {
      const iframe = Client.wrapper?.querySelector('iframe')
      const coords: string = (iframe?.contentWindow as any)?.persona?.getCoords?.() ?? ''
      if (!coords || coords === lastCoords) return
      lastCoords = coords
      fetchAPI('/api/avatar', { method: 'POST', credentials: 'include', body: JSON.stringify({ coords }), headers: { 'Content-Type': 'application/json' } })
    }, 1000)
    return () => clearInterval(interval)
  }, [props.isOwner])

  const handledGetAddress = (wallet: string | undefined) => {
    if (!wallet) return undefined
    try {
      return ethers.getAddress(wallet)
    } catch {
      return undefined
    }
  }

  const fetchHomeParcel = (homeId: number) => {
    cachedFetch(`/api/parcels/${homeId}.json`)
      .then((r) => r.json())
      .then((data) => setHomeParcel(data.parcel ?? null))
      .catch(() => setHomeParcel(null))
  }

  const fetch = () => {
    fetchAPI(`/api/avatars/${walletOrUUId}.json`).then((data) => {
      setAvatar(data.avatar)
      if (data.avatar?.home_id) fetchHomeParcel(data.avatar.home_id)
    })

    cachedFetch(`/api/avatars/${walletOrUUId}/costumes`)
      .then((r) => r.json())
      .then((data) => setCostumes(data.costumes ?? []))

    fetchUsersCollectibles(walletOrUUId).then((results) => setWearables(results.length))
    cachedFetch(`/api/womps/by/${walletOrUUId}`)
      .then((r) => r.json())
      .then((data) => setWomps(data.womps?.length ?? 0))
    cachedFetch(`/api/wallet/${walletOrUUId}/contributing-parcels.json`)
      .then((r) => r.json())
      .then((data) => setCollabs(data?.parcels?.length ?? 0))
  }

  // cache busting avatar fetching
  const fetchAvatar = () => fetchAPI(`/api/avatars/${walletOrUUId}.json?cb=${Date.now()}`).then((data) => setAvatar(data.avatar))

  const walletAddress = handledGetAddress(walletOrUUId) ?? '0x0000000000000000000000000000000000000000'
  const copyWalletToClipboard = () => {
    walletAddress &&
      copyTextToClipboard(
        walletAddress,
        () => app.showSnackbar(`Copied wallet address to clipboard ${walletOrUUId}`, PanelType.Success),
        () => app.showSnackbar(`Could not copy wallet`, PanelType.Info),
      )
  }

  const descriptionValidator = (value: string) => {
    if (!value) return true
    if (value.length > 500) {
      app.showSnackbar('Description is more than 500 characters', PanelType.Danger)
      return false
    }
    return true
  }

  const setHomeId = async (parcelId: number | null) => {
    await fetchAPI('/api/avatar', { method: 'POST', credentials: 'include', body: JSON.stringify({ home_id: parcelId }), headers: { 'Content-Type': 'application/json' } })
    if (parcelId) {
      fetchHomeParcel(parcelId)
    } else {
      setHomeParcel(null)
    }
    setShowHomeSearch(false)
  }

  const onHomeSearchInput = async (e: Event) => {
    const val = (e.target as HTMLInputElement).value
    if (val.length < 2) return
    const r = await cachedFetch(`/api/parcels/search.json?q=${encodeURIComponent(val)}&limit=8`)
    const data = await r.json()
    const opts = (data.parcels ?? []).map((p: any) => ({ id: p.id, label: p.name ?? p.address ?? `#${p.id}` }))
    setParcelOptions(opts)
    // check if the typed value matches one of the options
    const match = opts.find((o: any) => o.label === val)
    if (match) setHomeId(match.id)
  }

  const owner = props.isOwner
  const name = avatar?.name ?? (props.walletOrUUId ? ethTrunc(props.walletOrUUId!) : 'anon')
  const hasWallet = props.walletOrUUId.match(/0x/)

  return (
    <section class="columns profile">
      <hgroup style={{ flexGrow: 1 }}>
        {props.isOwner ? (
          <>
            <h1 class="account-name-hero">{name}</h1>
            <p class="account-welcome-msg">Welcome to Voxels.</p>
          </>
        ) : (
          <>
            <h1>{name}</h1>
          </>
        )}
      </hgroup>

      <article>
        {owner && (
          <figure>
            <ClientBar costumes={costumes.length > 0 ? costumes : undefined} />
            <Client parcelId={homeParcel?.id} coords={avatar?.coords ?? ''} />
          </figure>
        )}
        <h2>Costumes</h2>

        <table>
          {' '}
          <tbody>
            {costumes.map((c) => (
              <tr>
                <td>
                  <a href={`/costumer/${c.id}`}>{c.name}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Womps</h2>
        <WompsList hint={'You have no womps! Take a womp in world (using shortcut P)'} numberToShow={20} collapsed={false} ttl={60} fetch={`/womps/by/${props.walletOrUUId}`} />
      </article>

      <aside>
        <h3>Description</h3>

        <div>
          <EditableDescription value={avatar?.description ?? null} isowner={owner} validationRule={descriptionValidator} type={AssetType.Avatar} data={avatar} title="Description of your avatar" />
        </div>

        <dl>
          <dt>Home</dt>
          <dd>
            {homeParcel ? (
              <span>
                <a
                  href={`/parcels/${homeParcel.id}`}
                  onClick={(e) => {
                    const iframe = Client.wrapper?.querySelector('iframe')
                    const h = new ParcelHelper(homeParcel)
                    if (iframe) {
                      e.preventDefault()
                      ;(iframe.contentWindow as any)?.persona?.naviport(h.spawnCoords)
                    }
                  }}
                >
                  {(homeParcel as any).name ?? (homeParcel as any).address ?? `#${homeParcel.id}`}
                </a>
                {owner && (
                  <>
                    {' '}
                    &mdash; <a onClick={() => setShowHomeSearch(!showHomeSearch)}>change</a>
                  </>
                )}
              </span>
            ) : owner ? (
              <a onClick={() => setShowHomeSearch(!showHomeSearch)}>set one</a>
            ) : (
              <span>None</span>
            )}
            {owner && showHomeSearch && (
              <div>
                <input ref={homeSearchRef} type="search" placeholder="Search parcels..." onInput={onHomeSearchInput} />
                {parcelOptions.length > 0 && (
                  <ul class="datalist">
                    {parcelOptions.map((o) => (
                      <li key={o.id} onClick={() => setHomeId(o.id)}>
                        {o.label}
                      </li>
                    ))}
                  </ul>
                )}
                {homeParcel && <a onClick={() => setHomeId(null)}>clear</a>}
              </div>
            )}
          </dd>
          <dt>Parcels</dt>
          <dd>
            <Parcels wallet={props.walletOrUUId} isOwner={props.isOwner} />
          </dd>

          <dt>Collaborations</dt>
          <dd>
            <Contributor wallet={props.walletOrUUId} isOwner={props.isOwner} />
          </dd>

          <dt>Spaces</dt>
          <dd>
            <Spaces wallet={props.walletOrUUId} isOwner={props.isOwner} />
          </dd>

          {hasWallet && (
            <>
              <dt>Wallet</dt>
              <dd>
                <a onClick={copyWalletToClipboard} title="Click to copy wallet address to clipboard">
                  {ethTrunc(walletAddress)}
                </a>
                <br />
                <a href={`https://etherscan.io/address/${walletAddress}`} title="View on etherscan.io">
                  Etherscan
                </a>
                <br />
                {!handledGetAddress(walletOrUUId) && <small>Id: {walletOrUUId}</small>}
              </dd>
            </>
          )}

          {avatar?.moderator && (
            <Fragment>
              <dt>Role</dt>
              <dd>Moderator</dd>
            </Fragment>
          )}
          <dt>Wearables</dt>
          <dd>{props.isOwner ? <a href="/account/collectibles">{wearables}</a> : wearables}</dd>
          <dt>Link</dt>
          <dd>
            {!owner && <SocialLink socialUrl={avatar?.social_link_1 ?? ''} maxLength={48} />}
            {owner && <EditSocialLink socialLinkNumber={1} avatar={avatar} onSave={fetchAvatar} />}
          </dd>
          <dt>Link</dt>
          <dd>
            {!owner && <SocialLink socialUrl={avatar?.social_link_2 ?? ''} maxLength={48} />}
            {owner && <EditSocialLink socialLinkNumber={2} avatar={avatar} onSave={fetchAvatar} />}
          </dd>
          <dt>Joined</dt>
          <dd>{avatar?.created_at ? format(avatar.created_at) : 'The mists of time'}</dd>
        </dl>
      </aside>
    </section>
  )
}
