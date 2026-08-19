import { parcelRendererUrl } from '../../common/renderable/thumb-url'
import { noCache } from '../cache'
import Parcel from '../parcel'
import { queryAndCallback } from '../lib/query-helpers'
import db from '../pg'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { Request, Response } from 'express'
function getLocation(parcel: Parcel) {
  const x = Math.round((parcel.x1 + parcel.x2) / 2)
  const z = Math.round((parcel.z1 + parcel.z2) / 2)

  const e = x < 0 ? `${Math.abs(x)}W` : `${x}E`
  const n = z < 0 ? `${Math.abs(z)}S` : `${z}N`
  const u = parcel.y1 > 0 ? `${parcel.y1}U` : ''

  return [e, n, u].join(',')
}

export default function getTokenMetadata(req: Request, res: Response) {
  const construct = (parcel: Parcel) => {
    const external_url = `https://www.voxels.com/parcels/${parcel.id}`

    // const companyParcel = parcel.owner.toLowerCase() == '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'.toLowerCase()

    const loc = getLocation(parcel)
    const animationUrl = `https://www.voxels.com/play?coords=${loc}&embedded=true&isolate=true`

    const helper = new ParcelHelper(parcel)
    const isWaterfront = helper.isWaterFront

    const description_footer = `  
[Visit Voxels for more info.](${external_url})`

    const parcelDescription = () => {
      if (parcel.kind == 'inner') {
        return (
          `${isWaterfront ? 'Waterfront ' : ''}Pre-built parcel with uneditable external layer near ${parcel.suburb} in ${parcel.island}, ${Math.floor(
            parcel.distance_to_center,
          )}m from the origin, with a ${Math.floor(parcel.height)}m build height. ` + description_footer
        )
      }

      if (parcel.y1 <= 0) {
        return (
          `${isWaterfront ? 'Waterfront ' : ''}Parcel ${parcel.y1 < 0 ? 'with basement ' : ''}near ${parcel.suburb} in ${parcel.island}, ${Math.floor(
            parcel.distance_to_center,
          )}m from the origin, with a ${Math.floor(parcel.height)}m build height. ` + description_footer
        )
      } else {
        return (
          `${isWaterfront ? 'Waterfront ' : ''}Parcel near ${parcel.suburb} in ${parcel.island}, ${Math.floor(parcel.distance_to_center)}m from the origin, with a ${Math.floor(
            parcel.height,
          )}m build height and floor is at ${parcel.y1}m elevation. ` + description_footer
        )
      }
    }

    const image = parcelRendererUrl(parcel.id)

    return {
      name: parcel.address,
      image,
      animation_url: animationUrl,
      description: parcelDescription(),
      attributes: {
        width: parcel.x2 - parcel.x1,
        depth: parcel.z2 - parcel.z1,
        height: parcel.height,
        elevation: parcel.y1 < 0 ? 0 : parcel.y1,
        suburb: parcel.suburb,
        island: parcel.island,
        has_basement: parcel.y1 < 0 ? 'yes' : 'no',
        title: parcel.kind,
        'pre-built': parcel.kind == 'inner',
        waterfront: isWaterfront ? 'yes' : 'no',
        'closest-common': helper.closestCommon,
      },
      external_url,
      background_color: 'f3f3f3',
    }
  }

  const id = Number(req.params.id)

  if (isNaN(id)) {
    noCache(res)
    res.status(404).send('Not found')
    return
  }

  if (!Number.isInteger(id)) {
    noCache(res)
    res.status(400).send('parcel token id is not valid')
    return
  }
  if (!Number.isSafeInteger(id)) {
    noCache(res)
    res.status(400).send('parcel token id is not valid')
    return
  }

  queryAndCallback<Parcel>(db, 'get-parcel', 'parcel', [id, false], async (result) => {
    if (!result.success) {
      const parcel = await Parcel.load(id)

      if (!parcel?.id) {
        noCache(res)
        res.status(404).send('Not found')
        return
      }

      try {
        await parcel.queryContract()
        if (!parcel.minted) throw new Error('Parcel not minted')
        res.json(construct(parcel))
      } catch {
        res.json({ success: false, error: 'not minted' })
      }

      return
    }

    const parcel = result.parcel
    res.json(construct(parcel))
  })
}
