import { Express, Response } from 'express'
import { PassportStatic } from 'passport'
import { UploadMediaType, ugcKey } from '../../common/helpers/ugc-upload-keys'
import { presignPut, ugcConfigured, ugcExists } from '../lib/ugc'
import { VoxelsUserRequest } from '../user'

const MAX_UPLOAD = 50 * 1024 * 1024
const ALLOWED_EXT = /\.(jpe?g|gif|png|webp|vox|mp3|mp4)$/i

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

    const { name, contentType, contentLength, mediaType } = req.body as {
      name?: string
      contentType?: string
      contentLength?: number
      mediaType?: UploadMediaType
    }

    if (!name || !allowedName(name)) {
      return res.status(400).json({ success: false, error: 'bad file name' })
    }

    const size = Number(contentLength)
    if (!size || size > MAX_UPLOAD) {
      return res.status(400).json({ success: false, error: 'file must be under 50MB' })
    }

    const type: UploadMediaType = mediaType === 'womps' || mediaType === 'assetlibrary' ? mediaType : 'parcel-content'
    const key = ugcKey(wallet, type, name)
    if (await ugcExists(key)) return res.json({ success: true, exists: true, key })
    const uploadUrl = await presignPut(key, contentType || 'application/octet-stream', size)
    return res.json({ success: true, exists: false, uploadUrl, key })
  })
}
