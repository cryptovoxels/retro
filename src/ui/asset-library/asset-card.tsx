import { bucketUrl } from '../../../web/src/tiles/asset-tile'
import { LibraryAsset } from '../../library-asset'
import { avatarName } from '../../../common/messages/avatar-ref'

export function AssetCard(props: { asset: LibraryAsset }) {
  const asset = props.asset

  return (
    <div class="AssetCard -small">
      <header>
        <div class="name">{asset.name || 'My Asset'}</div>
      </header>
      {asset.id && <img src={bucketUrl(asset.id)} />}

      <footer>
        <div class="author">Author: {asset.author ? avatarName(asset.author as any) : ''}</div>
      </footer>
    </div>
  )
}
