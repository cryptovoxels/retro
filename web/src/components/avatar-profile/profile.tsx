import * as ethers from 'ethers'
import { useEffect, useState } from 'preact/hooks'
import { format } from 'timeago.js'
import { copyTextToClipboard } from '../../../../common/helpers/utils'
import { ApiAvatar } from '../../../../common/messages/api-avatars'
import { SimpleSpaceRecord } from '../../../../common/messages/space'
import { Costume } from '../../../../common/types'
import { ethTrunc } from '../../../../common/utils'
import { Contributor } from '../../../account/contributor'
import { Parcels } from '../../../account/parcels'
import { Spaces } from '../../../account/spaces'
import cachedFetch from '../../helpers/cached-fetch'
import { app } from '../../state'
import { PanelType } from '../panel'
import WompsList from '../../womps-list'
import { truncate } from 'lodash'
import Delegations from '../account/delegations'

type Props = {
  walletOrUUId: string
  tab?: string
  isOwner?: boolean
}

export default function Profile(props: Props) {
  const [avatar, setAvatar] = useState<ApiAvatar | undefined>(undefined)
  const [costumes, setCostumes] = useState<Costume[]>([])
  const [collections, setCollections] = useState<{ id: number; name: string }[]>([])
  const [spaces, setSpaces] = useState<SimpleSpaceRecord[]>([])
  const { walletOrUUId, isOwner } = props

  useEffect(() => {
    cachedFetch(`/api/avatars/${walletOrUUId}.json`)
      .then((r) => r.json())
      .then((data) => setAvatar(data.avatar))
    cachedFetch(`/api/avatars/${walletOrUUId}/costumes`)
      .then((r) => r.json())
      .then((data) => setCostumes(data.costumes ?? []))
    cachedFetch(`/api/collections?owner=${walletOrUUId}&limit=50`)
      .then((r) => r.json())
      .then((data) => setCollections(data.collections ?? []))
    cachedFetch(`/api/wallet/${walletOrUUId}/spaces.json`)
      .then((r) => r.json())
      .then((data) => setSpaces(data.spaces ?? []))
  }, [walletOrUUId])

  const walletAddress = (() => {
    try {
      return ethers.getAddress(walletOrUUId)
    } catch {
      return undefined
    }
  })()

  const copyWallet = () =>
    copyTextToClipboard(
      walletOrUUId,
      () => app.showSnackbar(`Copied wallet address`, PanelType.Success),
      () => app.showSnackbar(`Could not copy`, PanelType.Info),
    )

  const name = avatar?.name
  const hasWallet = !!walletAddress

  return (
    <section class="columns profile">
      <article>
        {name && (
          <hgroup>
            <h1>{name}</h1>
            {isOwner && (
              <a href="/account/edit" role="button">
                edit account
              </a>
            )}
          </hgroup>
        )}
        {avatar?.description && <p>{avatar.description}</p>}

        <dl>
          {hasWallet && (
            <>
              <dt>wallet address</dt>
              <dd>
                <a onClick={copyWallet} title="click to copy">
                  {ethTrunc(walletOrUUId)}
                </a>{' '}
                &mdash;{' '}
                <a href={`https://etherscan.io/address/${walletOrUUId}`} target="_blank">
                  etherscan
                </a>
              </dd>
            </>
          )}

          {avatar?.social_link_1 && (
            <>
              <dt>homepages</dt>
              <dd>
                <a href={avatar.social_link_1} target="_blank">
                  {truncate(avatar.social_link_1, { length: 48 })}
                </a>
                <br />
                <a href={avatar.social_link_2!} target="_blank">
                  {truncate(avatar.social_link_2!, { length: 48 })}
                </a>
              </dd>
            </>
          )}

          {avatar?.moderator && (
            <>
              <dt>role</dt>
              <dd>moderator</dd>
            </>
          )}

          <dt>joined</dt>
          <dd>{avatar?.created_at ? format(avatar.created_at) : 'the mists of time'}</dd>
        </dl>

        {isOwner && <Delegations />}

        <Parcels wallet={walletOrUUId} isOwner={isOwner} />
        <Contributor wallet={walletOrUUId} isOwner={isOwner} />
        <Spaces wallet={walletOrUUId} isOwner={isOwner} />

        {collections.length > 0 && (
          <>
            <h2>collections</h2>
            <table>
              <tbody>
                {collections.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a href={`/collections/${c.id}`}>{c.name}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {costumes.length > 0 && (
          <>
            <h2>costumes</h2>
            <table>
              <tbody>
                {costumes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a href={`/costumer/${c.id}`}>{c.name}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <WompsList title="womps" numberToShow={20} collapsed={false} ttl={60} fetch={`/womps/by/${walletOrUUId}`} quiet />
      </article>
    </section>
  )
}
