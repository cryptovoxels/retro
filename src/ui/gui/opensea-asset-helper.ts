import { ApiAssetOpensea, OwnershipRecord, ProxyAssetOpensea, TraitRecord } from '../../../common/messages/api-opensea'
import { tidyInt } from '../../utils/helpers'

interface ownerData {
  username: string | null
  address: string
}

export default class OpenseaAssetHelper {
  public description: string | null
  private asset_contract: ApiAssetOpensea['asset_contract']
  private readonly traits: TraitRecord[] = []
  private readonly top_ownerships: OwnershipRecord[] = []
  private ownership: { owner: { address: string } } | null = null
  private readonly image_url: string | null
  private readonly image_preview_url: string | null = null
  private readonly image_original_url: string | null = null
  private creator: any
  private owner: any
  private readonly name: string | null
  private animation_url: any

  constructor(obj: ApiAssetOpensea | ProxyAssetOpensea) {
    // Explicit assignments better for static analysis
    this.asset_contract = obj.asset_contract
    if ('traits' in obj && obj.traits) {
      this.traits = obj.traits
    }
    if ('top_ownerships' in obj && obj.top_ownerships) {
      this.top_ownerships = obj.top_ownerships
    }
    if ('ownership' in obj && obj.ownership) {
      this.ownership = obj.ownership
    }
    this.image_url = obj.image_url

    if ('image_preview_url' in obj && obj.image_preview_url) {
      this.image_preview_url = obj.image_preview_url
    }
    if ('image_original_url' in obj && obj.image_original_url) {
      this.image_original_url = obj.image_original_url
    }
    this.name = obj.name
    this.description = obj.description

    Object.assign(this, obj)
  }

  /**
   * {boolean} Returns whether asset is ERC1155 or not
   */
  get isERC1155() {
    if (!this.asset_contract.schema_name) {
      return false
    }
    return this.asset_contract.schema_name === 'ERC1155'
  }

  /**
   * return true if collectible is CV collection
   */
  get isWearable() {
    return this.isERC1155 && this.asset_contract.address === process.env.WEARABLE_CONTRACT_ADDRESS
  }

  /**
   * return true if asset has animation
   */
  get isAnimated() {
    if (!this.animation_url) return false

    // ipfs URL generally do not have an extension, so we return true just in case.
    if (this.animation_url.match(/ipfs/g)) return true

    let url: URL
    try {
      url = new URL(this.animation_url)
    } catch {
      return false
    }
    if (!url.pathname) return false

    const extension = url.pathname.split('.').pop()?.trim() ?? ''
    return ['mp3', 'wav', 'mp4', 'mv4', 'gif', 'mov', 'webm', 'ogg', 'oga'].includes(extension.toLowerCase())
  }

  /**
   * return image
   */
  get getImage(): string {
    return this.image_url || this.image_preview_url || this.image_original_url || `${process.env.ASSET_PATH}/images/error-could_not_fetch_nft.png`
  }

  /**
   * return issues from traits (only erc1155)
   */
  get getIssues(): number | undefined {
    const rarityTrait = this.traits && this.traits.filter((f) => f.trait_type === 'issues')
    return rarityTrait ? tidyInt(rarityTrait?.[0]?.value, 1000) : undefined
  }

  /**
   * Returns opensea's top_ownership;
   * only available for ERC1155
   */
  get topOwnership() {
    return this.top_ownerships || []
  }

  // so will try to do a little hack here, since the opensea will use a w=500&auto=format in the image formats, which

  get creatorWallet() {
    return this.creator.address
  }

  /**
   * If Collectible, get the author from the traits.
   * If not collectible, get author from Opensea's creator attribute
   *
   */
  get getCreator() {
    if (this.isWearable) {
      return this.getAuthor
    }
    if (!this.creator) {
      return 'Unknown'
    }
    return this.creator.user && this.creator.user.username ? this.creator.user.username : this.creator.address
  }

  /**
   * Returns if asset.owner is the nullAddress
   */
  get isOwnerNullAddress() {
    return this.getOwner.address === '0x0000000000000000000000000000000000000000' || this.getOwner.address === 'NullAddress'
  }

  /**
   * Returns name of the asset
   */
  get getName() {
    return this.name ? this.name : 'Unknown item'
  }

  /**
   * return author from traits (only erc1155)
   */
  private get getAuthor() {
    const authorTrait = this.traits && this.traits.filter((f) => f.trait_type === 'author')
    return authorTrait ? authorTrait[0].value : 'unknown'
  }

  private get getOwner(): ownerData {
    return this.owner
      ? {
          username: this.owner.user && this.owner.user.username ? this.owner.user.username : null,
          address: this.owner.address,
        }
      : { username: 'unknown', address: 'unknown' }
  }

  getTypeOfContent = async (): Promise<'image' | 'audio' | 'video'> => {
    if (!this.animation_url) return 'image'

    const mimeTypeToType = (s: string | void | null) => {
      if (s?.startsWith('audio')) return 'audio'
      if (s?.startsWith('video')) return 'video'
      return undefined
    }

    // first try to use the content type in a HEAD request instead of doing a GET request
    const contentType = await fetch(this.animation_url, { method: 'HEAD' })
      .then((r) => (r.ok ? r.headers.get('content-type') : ''))
      .catch(console.error)

    const type = mimeTypeToType(contentType)
    if (type) return type

    // if that didn't work, we better download the thing and check it's magic mime type
    const response = await fetch(this.animation_url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} - ${r.statusText} | ${this.animation_url}`)
        return r
      })
      .catch(console.error)

    if (!response?.body) return 'image'

    return 'image'
  }

  // is a resized to 500w image, we can hack the plane.. that number to request a bigger sized image
  getBiggerImage(size = 1024): string {
    const url = this.image_url || this.image_preview_url || this.image_original_url
    if (!url) {
      return `${process.env.ASSET_PATH}/images/error-could_not_fetch_nft.png`
    }

    if (!url.includes('w=')) {
      return url
    }

    let u: URL
    try {
      u = new URL(url)
    } catch (e) {
      console.error(`NFT URL ${url} is not a valid URL`)
      return `${process.env.ASSET_PATH}/images/error-could_not_fetch_nft.png`
    }
    u.searchParams.set('w', `${size}`)
    return u.toString()
  }

  /**
   * Returns owner's name of the asset, if name is null, return address.
   *
   * If not ERC11555, tries to get owner's name or address if name is null.
   * If it is, return the person that owns the most of it.
   * @param parcelOwner [optional] The owner address of the parcel.
   * if set, function returns parcel owner as owner (if he owns any of the asset)
   *
   * Returns {username: string, address: string}
   */
  getTopOwner(parcelOwner?: string): ownerData | null {
    if (!this.isERC1155) {
      return this.getOwner
    }
    let owner
    const top = this.topOwnership
    // topOwnership is empty
    if (!top[0]) {
      owner = this.getOwner
    } else {
      owner = top[0].owner.user && { username: top[0].owner.user.username, address: top[0].owner.address }
    }

    if (parcelOwner) {
      const parcelO = top.find((o) => o.owner.address.toLowerCase() === parcelOwner.toLowerCase())
      if (parcelO) {
        owner = parcelO.owner.user && { username: parcelO.owner.user.username, address: parcelO.owner.address }
      }
      return owner
    }
    return owner
  }

  isOwner(wallet: string) {
    if (!wallet) return false
    const w = wallet.toLowerCase()
    const owners = (this as any).owners as { address: string; quantity: number }[] | undefined
    if (owners?.some((o) => o.address?.toLowerCase() === w && (o.quantity ?? 1) > 0)) {
      return true
    }
    // legacy v1 shape, kept for safety
    return this.ownership?.owner?.address?.toLowerCase() === w
  }
}
