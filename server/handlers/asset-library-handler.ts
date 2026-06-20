import LibraryAsset from '../library-asset'
import { isNull, pick } from 'lodash'
import { Request, Response } from 'express'
import { isMod } from '../lib/helpers'
import { VoxelsUserRequest } from '../user'

export async function addAssetToLibrary(req: Request, res: Response) {
  const asset = pick(req.body, ['type', 'author', 'name', 'description', 'image_url', 'category', 'public', 'content'])

  const libraryAsset = new LibraryAsset(asset)

  if (typeof libraryAsset.type !== 'string' || typeof libraryAsset.author !== 'string' || typeof libraryAsset.name !== 'string') {
    res.json({ success: false })
    return
  }
  if (typeof libraryAsset.description !== 'string' || typeof libraryAsset.category !== 'string') {
    res.json({ success: false })
    return
  }
  if (!libraryAsset.content) {
    res.json({ success: false })
    return
  }
  const response = await libraryAsset.create()
  res.json({ success: !!response.success, id: libraryAsset.id, ...(!!response.message && { message: response.message }) })
}

export async function removeAssetFromLibrary(req: VoxelsUserRequest, res: Response) {
  const asset = pick(req.body, ['id'])

  if (!asset.id) {
    res.json({ success: false })
    return
  }
  const libraryAsset = await LibraryAsset.loadFromId(asset.id)

  if (!libraryAsset) {
    res.json({ success: false })
    return
  }
  // If not author and not mod you can't remove.
  if (libraryAsset.author.toLowerCase() !== req.user?.wallet?.toLowerCase() && !isMod(req)) {
    res.json({ success: false })
    return
  }

  const response = await libraryAsset.remove()
  res.json({ success: !!response.success, ...(!!response.message && { message: response.message }) })
}

export async function updateAssetFromLibrary(req: VoxelsUserRequest, res: Response) {
  if (!req.user || !req.user.wallet) {
    res.json({ success: false })
    return
  }
  const asset = pick(req.body, ['id', 'name', 'description', 'category', 'public'])

  if (!asset.id) {
    res.json({ success: false })
    return
  }
  const libraryAsset = await LibraryAsset.loadFromId(asset.id)

  if (!libraryAsset) {
    res.json({ success: false })
    return
  }

  // If not author you can't edit.
  if (libraryAsset.author.toLowerCase() !== req.user.wallet.toLowerCase()) {
    res.json({ success: false })
    return
  }

  Object.entries(asset)
    .filter(([key]) => {
      return !isNull((asset as Record<string, any>)[key])
    })
    .forEach(([key]) => {
      ;(libraryAsset as any)[key] = (asset as Record<string, any>)[key]
    })

  const response = await libraryAsset.update()

  res.json({ success: !!response.success, ...(!!response.message && { message: response.message }) })
}
