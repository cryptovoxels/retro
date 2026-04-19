import Wearable from '../wearable'
import { Request, Response } from 'express'
import { isMod } from '../lib/helpers'
import Collection from '../collection'
import { postman } from './mails-handler'
import { getCollectibleAmountForWallet } from '../lib/ethereum-helpers'
import { ethers } from 'ethers'
import { SUPPORTED_CHAINS, SUPPORTED_CHAINS_BY_ID, SUPPORTED_CHAINS_KEYS } from '../../common/helpers/chain-helpers'
import { VoxelsUserRequest } from '../user'

const toUint8Array = require('base64-to-uint8array')

export async function createCollectible(req: Request, res: Response) {
  const { name, description, author } = req.body
  let collectible: undefined | Wearable = undefined

  // api/collectibles/create/wearable
  if (req.path.match('/wearable')) {
    // We're minting a wearable
    const { issues, collection_id, category, custom_attributes } = req.body

    const data = toUint8Array(req.body.data)

    collectible = new Wearable({
      name,
      description,
      author,
      category,
      issues,
      data,
      collection_id,
      custom_attributes,
    })
  }
  if (!collectible) {
    return
  }

  const result = await collectible.create()
  res.json(result)
}

export async function updateWearable(req: VoxelsUserRequest, res: Response) {
  if (!req.user || !req.user.wallet) {
    res.status(403).json({ success: false })
    return
  }
  const wearable = await Wearable.loadFromId(req.params.id)
  let response = null

  if (!wearable) {
    res.status(200).send({ success: false, message: `Could not find collectible;` })
    return
  }
  const isModerator = isMod(req)
  /* Check if owner of collection or mod */

  const collectionOfCollectible = wearable.collection_id ? await Collection.loadFromId(wearable.collection_id) : null

  const isCollectionOwner = collectionOfCollectible?.owner && collectionOfCollectible.owner.toLowerCase() === req.user.wallet.toLowerCase()
  const isCollectibleCreator = wearable.author && wearable.author.toLowerCase() === req.user.wallet.toLowerCase()

  // New token id
  if ('token_id' in req.body) {
    // Handle off-chain wearable
    if ('isOffChain' in req.body && req.body.isOffChain) {
      if (!isModerator) {
        // Only a moderator can set the tokenId of an off-chain wearable
        res.status(403).send({ success: false })
        return
      }
      response = await wearable.giveOffChainWearableATokenId()
    } else {
      if (!collectionOfCollectible || !collectionOfCollectible.chainId || !collectionOfCollectible.address) {
        res.status(200).send({ success: false, message: `Could not find collection of collectible;` })
        return
      }

      if (!isCollectibleCreator && !isCollectionOwner) {
        // Only a the collectible creaor or the collection owner can set the token id
        res.status(403).send({ success: false })
        return
      }

      const tokenId = parseInt(req.body.token_id, 10)

      // We minted a wearable so we're updating its token_id
      if (isNaN(tokenId) || !wearable.collection_id || isNaN(wearable.collection_id)) {
        return res.status(400).json({ success: false, message: 'not valid token_id or collection_id' })
      }
      // Check if didn't already give that token id
      const twin = await Wearable.loadFromChainInfo(collectionOfCollectible.chainId, collectionOfCollectible.address, tokenId)
      if (twin) {
        res.status(200).send({ success: false, message: `A collectible has the same token_id in this collection.` })
        return
      }
      wearable.token_id = tokenId

      response = await wearable.saveTokenId()

      if (response.success && wearable.author) {
        // If success on save, send a mail to users saying their wearable is saved
        const body = {
          destinator: wearable.author,
          subject: 'Collectible Minted!',
          content: `## Congratulation!
          Your wearable minted!
          **Token ${wearable.token_id}**
          [See here](https://www.voxels.com/collections/${SUPPORTED_CHAINS_BY_ID[collectionOfCollectible.chainId]}/${collectionOfCollectible.address}/${wearable.token_id})
          `,
        }
        postman(body)
      }
    }
  }

  // New custom_attributes
  if ('custom_attributes' in req.body) {
    // We changed the custom traits
    if (!isCollectibleCreator && !isCollectionOwner) {
      res.status(403).send({ success: false })
      return
    }
    wearable.custom_attributes = req.body.custom_attributes?.length > 0 ? req.body.custom_attributes : []

    response = await wearable.setCustomAttributes()
  }

  // New name or description
  if ('name' in req.body || 'description' in req.body) {
    // We changed the custom traits

    if (!isCollectibleCreator) {
      res.status(403).send({ success: false })
      return
    }

    if (req.body.name) {
      wearable.name = req.body.name
    }
    if (req.body.description) {
      wearable.description = req.body.description
    }

    response = await wearable.update()
  }

  // New Category
  if ('category' in req.body) {
    if (!isCollectibleCreator && !isCollectionOwner) {
      res.status(403).send({ success: false })
      return
    }

    wearable.category = req.body.category

    response = await wearable.update()
  }

  if (req.path.match('/suppress')) {
    if (!isModerator && !isCollectionOwner) {
      response = { success: false, message: 'You do not have the right to suppress this collectible' }
    } else {
      response = await wearable.suppress()
    }
  }
  if (req.path.match('/unsuppress')) {
    if (!isModerator && !isCollectionOwner) {
      response = { success: false, message: 'You do not have the right to unsuppress this collectible' }
    } else {
      response = await wearable.unsuppress()
    }
  }

  if (req.path.match('/delete')) {
    if (!isCollectibleCreator && !isModerator && !isCollectionOwner) {
      response = { success: false, message: 'You do not have the right to delete this collectible' }
    } else {
      if (wearable.token_id) {
        // Wearable is minted, DO NOT DELETE.
        // can only be suppressed
        response = { success: false, message: 'Collectible has been minted and can only be suppressed' }
      } else {
        response = await wearable.delete()
      }
    }
  }

  res.status(200).send(response)
}

export async function validateHashWearable(req: Request, res: Response) {
  const r = await Wearable.validateHashWearable(req.body.id, req.body.hash, req.body.owner)
  res.json(r)
}
