import { Express, Response } from 'express'
import { PassportStatic } from 'passport'
import { UploadMediaType, parcelUgcKey, ugcKey } from '../../common/helpers/ugc-upload-keys'
import authParcel from '../auth-parcel'
import { presignPut, ugcConfigured, ugcExists } from '../lib/ugc'
import Parcel from '../parcel'
import { VoxelsUserRequest } from '../user'

const MAX_UPLOAD = 50 * 1024 * 1024
const ALLOWED_EXT = /\.(jpe?g|gif|png|webp|vox|mp3|mp4|vrm|ktx)$/i

function allowedName(name: string) {
  if (!name || name.length > 512) return false
  if (name.includes('..') || name.includes('\\')) return false
  return ALLOWED_EXT.test(name)
}

export default function UgcController(passport: PassportStatic, app: Express) {
  app.post('/api/ugc/presign', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    if (!ugcConfigured()) {
      return res.status(500).json({ success: false, error: 'UGC not configured' })
    }

    const wallet = req.user?.wallet
    if (!wallet || wallet.startsWith('guest:')) {
      return res.status(403).json({ success: false, error: 'not authorised' })
    }

    const { name, contentType, contentLength, mediaType, parcelId } = req.body as {
      name?: string
      contentType?: string
      contentLength?: number
      mediaType?: UploadMediaType
      parcelId?: number
    }

    if (!name || !allowedName(name)) {
      return res.status(400).json({ success: false, error: 'bad file name' })
    }

    const size = Number(contentLength)
    if (!size || size > MAX_UPLOAD) {
      return res.status(400).json({ success: false, error: 'file must be under 50MB' })
    }

    const type: UploadMediaType = mediaType === 'womps' || mediaType === 'assetlibrary' || mediaType === 'avatar' ? mediaType : 'parcel-content'

    let key: string
    if (parcelId) {
      const id = Number(parcelId)
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: 'bad parcel id' })
      }
      const parcel = await Parcel.load(id)
      if (!parcel) return res.status(404).json({ success: false, error: 'parcel not found' })
      const auth = await authParcel(parcel, req.user || null)
      if (!auth) return res.status(403).json({ success: false, error: 'not authorised' })
      key = parcelUgcKey(id, name)
    } else {
      key = ugcKey(wallet, type, name)
    }

    if (await ugcExists(key)) return res.json({ success: true, exists: true, key })
    const uploadUrl = await presignPut(key, contentType || 'application/octet-stream', size)
    return res.json({ success: true, exists: false, uploadUrl, key })
  })
}
