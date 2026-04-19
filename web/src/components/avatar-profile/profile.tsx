import * as ethers from 'ethers'
import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { format } from 'timeago.js'
import { fetchUsersCollectibles } from '../../../../common/helpers/collections-helpers'
import { copyTextToClipboard } from '../../../../common/helpers/utils'
import { ApiAvatar } from '../../../../common/messages/api-avatars'
import cachedFetch from '../../helpers/cached-fetch'
import { AssetType } from '../../helpers/save-helper'
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
// import Collectibles from '../../../account/collectibles'

type Props = {
  walletOrUUId: string | undefined
  tab?: string
  isOwner?: boolean
}

export default function Profile(props: Props) {
  const [avatar, setAvatar] = useState<ApiAvatar | undefined>(undefined)
  const [collabs, setCollabs] = useState(0)
  const [wearables, setWearables] = useState(0)
  const [womps, setWomps] = useState(0)
  const { walletOrUUId } = props

  useEffect(() => fetch(), [walletOrUUId])

  const handledGetAddress = (wallet: string | undefined) => {
    if (!wallet) return undefined
    try {
      return ethers.getAddress(wallet)
    } catch {
      return undefined
    }
  }

  const fetch = () => {
    fetchAPI(`/api/avatars/${walletOrUUId}.json`).then((data) => {
      setAvatar(data.avatar)
    })

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

  const owner = props.isOwner
  const name = avatar?.name ?? (props.walletOrUUId ? ethTrunc(props.walletOrUUId!) : 'anon')

  return (
    <section class="columns profile">
      <hgroup style={{ flexGrow: 1 }}>
        {props.isOwner ? (
          <>
            <h1 class="account-name-hero">{name}</h1>
            <p class="account-welcome-msg">Welcome to Voxels. Explore parcels and spaces below, or open your collectibles from the header when you are in world.</p>
            <p class="account-logout-row">
              <button type="button" class="account-logout-btn" onClick={() => app.signout()}>
                Log out
              </button>
            </p>
          </>
        ) : (
          <>
            <h1>{name}</h1>
          </>
        )}
      </hgroup>

      <article>
        <h3>Womps</h3>
        <WompsList hint={'You have no womps! Take a womp in world (using shortcut P)'} numberToShow={20} collapsed={false} ttl={60} fetch={`/womps/by/${props.walletOrUUId}`} />
      </article>

      <aside>
        <h3>Parcels</h3>

        <Parcels wallet={props.walletOrUUId} isOwner={props.isOwner} />

        <h3>Collaborations</h3>

        <Contributor wallet={props.walletOrUUId} isOwner={props.isOwner} />

        <h3>Spaces</h3>
        <Spaces wallet={props.walletOrUUId} isOwner={props.isOwner} />
        <h3>Description</h3>

        <div>
          <EditableDescription value={avatar?.description ?? null} isowner={owner} validationRule={descriptionValidator} type={AssetType.Avatar} data={avatar} title="Description of your avatar" />
        </div>

        <dl>
          {!owner && (
            <Fragment>
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
            </Fragment>
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
