import { ethers } from 'ethers'
import Wearable from '../wearable'
import Collection from '../collection'
import log from './logger'
import { collectibleContract, countOwnedTokens_ERC721Contract, erc20Contract, ethAlchemy, getBalanceOfToken_ERC1155Contract, getOwnerOfToken_ERC721Contract, getTypeOfContract, getContract, polygonAlchemy, TokenAddress } from './utils'
import { tokensToEnter } from '../../common/messages/parcel'
import { SUPPORTED_CHAINS } from '../../common/helpers/chain-helpers'

/**
 *  Get the balance of a user given the chain (the main token of that chain)
 * eg: Amount of matic on matic, amount of Eth on Eth
 * @param wallet the wallet to get the balance of
 * @param chain the ETH (1) or MATIC (137) token
 * @returns
 */
export async function getWalletBalance(
  wallet: string,
  chain = 1,
): Promise<{
  balance: number
}> {
  if (!ethers.isAddress(wallet)) {
    return { balance: 0 }
  }

  const alchemy = chain == 1 ? ethAlchemy : polygonAlchemy
  const b = await alchemy.getBalance(wallet)
  const balance = parseFloat((parseInt(b.toString()) / 10 ** 18).toString()) // 18 decimals
  return { balance: balance }
}

/**
 *  Get the balance of a user given the token and the balance.
 * eg. amount of Matic on Ethereum or amount of WETH on matic
 * @param wallet the wallet to get the balance of
 * @param token The token address
 * @returns
 */
export async function getERC20Balance(
  wallet: string,
  token: TokenAddress,
  chain: number,
): Promise<{
  balance: number
}> {
  if (!ethers.isAddress(wallet)) {
    return { balance: 0 }
  }
  const contract = await erc20Contract(token, chain)
  if (!contract) {
    return { balance: 0 }
  }

  let b = 0
  try {
    b = await contract.balanceOf(wallet)
  } catch (e) {
    log.error(`failed getERC20Balance for ${wallet}, ${e}`, e)
  }

  let decimals = 18
  try {
    decimals = await contract.decimals()
  } catch {}

  const balance = parseFloat((parseInt(b.toString()) / 10 ** decimals).toString()) // 18 decimals
  return { balance: balance }
}

/**
 * Get count of parcels a user has
 * @param wallet the wallet to get the balance of
 * @returns
 */
export async function getParcelsCount(wallet: string) {
  if (!ethers.isAddress(wallet)) {
    return { parcels: 0 }
  }
  const contract = await getContract('parcel', SUPPORTED_CHAINS['eth'])
  const balance = await contract.balanceOf(wallet)
  if (!balance) {
    return { parcels: 0 }
  }

  return { parcels: balance.toNumber() }
}

/**
 * Get count of a specific wearable a user has.
 * @param wallet the wallet to get the balance of
 * @param collectible_uuid the uuid of the collectible.
 * @returns
 */
export async function getCollectibleAmountForWallet(
  chain: number,
  address: string,
  tokenId: number,
  wallet: string,
): Promise<{
  balance: number
}> {
  //off-chain handle
  if (chain == 0) {
    // Off-chain collectibles are "common" so 1000
    return { balance: 1000 }
  }
  const collectible = await Wearable.loadFromChainInfo(chain, address, tokenId)
  if (!collectible) {
    console.warn(`Could not find collectible for ${chain} ${address} ${tokenId}`)
    return { balance: 0 }
  }

  const contract = await collectibleContract(address, chain)
  let balance
  try {
    balance = await contract?.balanceOf(wallet, collectible.token_id)
  } catch (e: any) {
    log.error(e.toString ? e.toString() : e)
  }
  if (!balance) {
    return { balance: 0 }
  }
  return { balance: balance.toNumber() }
}

/**
 * Check whether the potential collection ID is already registered on chain
 * @param tokenId Potential collection id
 * @param chainId chain id 1,137,80001
 */
export async function isCollectionIDAlreadyOnChain(tokenId: number, chainId = 1): Promise<boolean> {
  const factoryContactAddress = chainId == 137 ? process.env.COLLECTION_FACTORY_CONTRACT_MATIC : process.env.COLLECTION_FACTORY_CONTRACT_ETH
  if (!factoryContactAddress || !ethers.isAddress(factoryContactAddress)) {
    return false
  }

  const alchemy = chainId == 1 ? ethAlchemy : polygonAlchemy

  const contract = new ethers.Contract(factoryContactAddress, quickFactoryABI, alchemy)

  let p
  try {
    p = await contract.getCollectionFromId(tokenId)
  } catch (e) {
    return true // safe
  }

  return p !== `0x0000000000000000000000000000000000000000`
}

const quickFactoryABI = [
  {
    inputs: [{ internalType: 'uint256', name: '_id', type: 'uint256' }],
    name: 'getCollectionFromId',
    outputs: [{ internalType: 'address', name: 'collection', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
]

/**
 * Checks whether the address is a valid collection address.
 * @param collection a collection object
 */
export async function collectionHasValidURI(collection: Collection): Promise<boolean> {
  if (!collection.address || !ethers.isAddress(collection.address)) {
    return true
  }
  const alchemy = collection.chainId == 1 ? ethAlchemy : polygonAlchemy
  const contract = new ethers.Contract(collection.address, quickcvCollectibleABI, alchemy)

  let p
  try {
    p = await contract.uri(1)
  } catch (e) {
    return true // safe
  }

  // THis is validating the legacy URI on purpose since we can't change it unless you modify the collections-factory
  return p === `https://www.cryptovoxels.com/c/${collection.id}/{id}`
}

const quickcvCollectibleABI = [
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'uri',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
]

/**
 *  Get a transaction Receipt from a TX
 * @param tx the TX
 * @param chain ETH (1) or MATIC (137)
 * @returns
 */
export async function getTransactionReceipt(tx: string, chain = 1): Promise<any> {
  if (!ethers.isHexString(tx)) {
    return null
  }
  const alchemy = chain == 1 ? ethAlchemy : polygonAlchemy

  return await (alchemy as any).getTransactionReceipt(tx)
}

/**
 *
 * @returns
 */
export async function getABIFromContractAddress(address: string, chainId = 1): Promise<any> {
  if (!ethers.isAddress(address)) {
    return null
  }

  let url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${address}&apikey=${process.env.ETHERSCAN_API_KEY}`
  if (chainId == 137) {
    url = `https://api.polygonscan.com/api?module=contract&action=getabi&address=${address}&apikey=${process.env.POLYGONSCAN_API_KEY}`
  }

  let p
  try {
    p = await fetch(url)
  } catch {
    return null
  }

  const r = await p.json()

  if (r?.status != '1') {
    return null
  }
  return JSON.parse(r.result)
}

/**
 * Checks is given address is a contract
 * @param address a string
 * @param chain_id
 */
export async function isAddressAContract(address: string, chain_id: number): Promise<boolean> {
  const alchemy = chain_id == 1 ? ethAlchemy : polygonAlchemy
  let p
  try {
    p = await alchemy.getCode(address)
  } catch (e) {
    return true // safe
  }

  return p !== `0x`
}

export async function userOwnsToken(token: tokensToEnter, user: { wallet: string }) {
  if (!token.type) {
    // we know token.type is going to be undefined here. so we hack the type with `as any`
    try {
      const tokenType = await getTypeOfContract((token as any).address, (token as any).chain)
      ;(token as any).type = tokenType
    } catch {
      return false
    }
  }

  if (token.type == 'erc20') {
    let erc20TokenBalance = { balance: 0 }
    try {
      erc20TokenBalance = await getERC20Balance(user.wallet, token.address as any, token.chain)
    } catch {}
    return !!erc20TokenBalance.balance
  }

  if (token.type == 'erc721') {
    // token is an ERC721 NFT COntract and we don't have a token_id specified (any owned is fine)
    if (!token.tokenId) {
      const r = await countOwnedTokens_ERC721Contract(user.wallet, token.address, token.chain)

      return !!r
    } else {
      // token is an ERC721 NFT COntract and we have a token_id specified
      const r = await getOwnerOfToken_ERC721Contract(token.tokenId, token.address, token.chain)
      return r?.toLowerCase() == user.wallet.toLowerCase()
    }
  } else if (token.type == 'erc1155') {
    if (!token.tokenId) {
      // for erc1155 we have to have a token ID or it won't work.
      return false
    }
    // token is an ERC155 NFT COntract and we have a token_id specified (mandatory)
    const r = await getBalanceOfToken_ERC1155Contract(user.wallet, token.address, token.tokenId, token.chain)

    return !!r
  }
}
