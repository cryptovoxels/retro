import { useEffect, useState } from 'preact/hooks'
import { requestPointerLock } from '../../../common/helpers/ui-helpers'
import Pagination from '../../../web/src/components/pagination'
import { featureTemplates, PlaceableFeatureTypes } from '../../features/_metadata'
import { LibraryAsset } from '../../library-asset'
import { AssetCard } from './asset-card'

interface AssetBrowserProps {
  loading: boolean
  assets: LibraryAsset[]
  total: number
  /* for pagination */
  page?: number
  paginationSetPage?: (page: number) => void
}

export const NUMBER_PER_PAGE = 48 // default on server-side in the controller, we never override this.

export function AssetBrowser(props: AssetBrowserProps) {
  const [total, setTotal] = useState<number>(props.total)

  useEffect(() => setTotal(props.total), [props.total])

  const spawnOnClick = (asset: LibraryAsset) => {
    const template = asset.content![0]
    delete template.position
    delete template.rotation

    if (!template.scale) {
      template.scale = [...featureTemplates[template.type as PlaceableFeatureTypes].scale]
    }
    // vox models uploaded without scale got [4,4,4] baked in server-side
    if (template.type === 'vox-model' && template.scale.every((s: number) => s === 4)) {
      template.scale = [...featureTemplates['vox-model'].scale]
    }

    if (asset.type !== 'script') {
      const ui = window.ui!

      ui.featureTool.setModeAdd(template)
      ui.setTool(ui.featureTool)
      requestPointerLock()
    }
  }

  if (!props.loading && !props.assets) {
    return null
  }

  const assets = props.assets.map((asset) => (
    <div class="asset-card-container" key={asset.id} onClick={() => spawnOnClick(asset)}>
      <AssetCard asset={asset} />
    </div>
  ))

  if (!props.loading && props.assets.length == 0) {
    return (
      <div className="asset-browser">
        <div className="Center">
          <h1>No Asset found</h1>
        </div>
      </div>
    )
  }

  const browserHasPagination = !!props.paginationSetPage && !!total

  return (
    <>
      <div className="asset-browser">{assets}</div>
      {!!assets.length && browserHasPagination && (
        <div className="">
          <Pagination total={props.total} page={props.page} perPage={NUMBER_PER_PAGE} callback={props.paginationSetPage} />
        </div>
      )}
    </>
  )
}
