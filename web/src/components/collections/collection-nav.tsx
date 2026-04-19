import { Collection, CollectionHelper } from '../../../../common/helpers/collections-helpers'
import { app } from '../../state'

export function CollectionTabsNavigation(props: { collection: Collection }) {
  const { collection } = props

  if (!collection) {
    return (
      <ul>
        <li>
          <a href={`/collections`}>{'<'} Go back</a>
        </li>
      </ul>
    )
  }
  const chainid = new CollectionHelper(collection).chainIdentifier
  const address = collection.address
  const isOwner = app.signedIn && app.state.wallet?.toLowerCase() == collection.owner?.toLowerCase()
  const isMod = app.signedIn && !!app.state.moderator
  const settings = collection.settings

  return (
    <dl>
      {settings?.website && (
        <>
          <dt>Website</dt>
          <dd>
            <a href={settings?.website}>{settings?.website.match(/opensea/g) ? 'OpenSea' : 'Website'}</a>
          </dd>
        </>
      )}
      {settings?.virtualStore && (
        <>
          <dt>Store</dt>
          <dd>
            <a href={'/parcels/' + settings.virtualStore}>Parcel#{settings.virtualStore}</a>
          </dd>
        </>
      )}
      {(isMod || !collection.discontinued) && (isOwner || isMod) && (
        <>
          <dt>Admin</dt>
          <dd>
            <a href={`/collections/${collection.id}/edit`}>Admin</a>
          </dd>
        </>
      )}
      {app.signedIn && (isOwner || isMod || !!settings?.canPublicSubmit) && !collection.discontinued && (
        <>
          <dt>Mint</dt>
          <dd>
            <a href={`/collections/${chainid}/${address}/tab/upload`}>Mint</a>
          </dd>
        </>
      )}
    </dl>
  )
}
