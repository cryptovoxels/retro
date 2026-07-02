import { ethers, AlchemyProvider, Interface } from 'ethers'
import { tokensToEnter } from '../../common/messages/parcel'
import log from './logger'
// import { Alchemy, Network } from 'alchemy-sdk' // REMOVED: Alchemy SDK no longer used
import { maticChain, SUPPORTED_CHAINS } from '../../common/helpers/chain-helpers'

export const ethAlchemy = new AlchemyProvider('homestead', process.env.ALCHEMY_ETH_API_KEY)
export const polygonAlchemy = new AlchemyProvider('matic', process.env.ALCHEMY_MATIC_API_KEY)

// ETHEREUM UTILS ----------------------------------------
export const ParcelContractABI = require('../../common/contracts/parcel.json')
export const NameContractABI = require('../../common/contracts/name-v2.json')
export const ColorContractABI = require('../../common/contracts/color.json')
export const tokenContractABI = require('../../common/contracts/external/erc20.json')

export const erc721ABI = require('../../common/contracts/external/erc721.json')
export const erc1155ABI = require('../../common/contracts/external/erc1155.json')
export const parcelInterface = new Interface(ParcelContractABI.abi)

// We have it here for CI to not fail
export enum TokenAddress {
  WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  MATIC = '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0',
  WETH_ON_MATIC = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
}

const NAME_ADDRESS = '0x684Cd10B02CdADE20f1858C6315052d66D1Eafc2'
const PARCEL_ADDRESS = '0x79986aF15539de2db9A5086382daEdA917A9CF0C'
const RINKEBY_PARCEL_ADDRESS = '0x13dBD857f5513C0d65a3a0690cF1e58a44D6a79e'

export const ADDRESSES = {
  PARCEL_ADDRESS,
  NAME_ADDRESS,
  RINKEBY_PARCEL_ADDRESS,
}

export const getContract = async (label: 'parcel' | 'name', chainId = SUPPORTED_CHAINS['matic']) => {
  const alchemy = chainId == 1 ? ethAlchemy : polygonAlchemy
  switch (label) {
    case 'parcel':
      return new ethers.Contract(process.env.CONTRACT_ADDRESS || PARCEL_ADDRESS, ParcelContractABI.abi, alchemy)
    case 'name':
      return new ethers.Contract(process.env.NAME_ADDRESS || NAME_ADDRESS, NameContractABI.abi, alchemy)
    default:
      throw new Error(`Unknown contract label: ${label}`)
  }
}

export const getProviderGivenChain = async (chain = 1) => {
  const provider = chain == 1 ? ethAlchemy : polygonAlchemy
  return provider
}

export const erc20Contract = async (address: TokenAddress, chain = 1): Promise<ethers.Contract | null> => {
  if (!ethers.isAddress(address)) {
    return null
  }
  const provider = await getProviderGivenChain(chain)
  return new ethers.Contract(address, tokenContractABI.abi, provider)
}

export const erc721Contract = async (address: string, chain = 1): Promise<ethers.Contract | null> => {
  if (!ethers.isAddress(address)) {
    return null
  }
  const provider = await getProviderGivenChain(chain)
  return new ethers.Contract(address, erc721ABI.abi, provider)
}

export const erc1155Contract = async (address: string, chain = 1): Promise<ethers.Contract | null> => {
  if (!ethers.isAddress(address)) {
    return null
  }
  const provider = await getProviderGivenChain(chain)
  return new ethers.Contract(address, erc1155ABI.abi, provider)
}

//or https://rpc-mainnet.maticvigil.com
// END ETHEREUM UTILS ----------------------------------------

export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function numberOfQuarterOfDaySinceGenesis(): number {
  // NOTE: all dates must be in UNIX timestamp, i.e. no timezone / UTC
  // timestamp when the traffic started to be recorded
  const since = Date.parse('2019-05-15T06:00:00.000Z')
  const seconds = (Date.now() - since) / 1000
  const hours = seconds / 60 / 60
  // we record the traffic per quarter day, not day as the database column might hint at
  return Math.floor(hours / 6)
}

export const countOwnedTokens_ERC721Contract = async (owner: string, address: string, chain = 1): Promise<number> => {
  if (!ethers.isAddress(address)) {
    return 0
  }
  if (!ethers.isAddress(owner)) {
    return 0
  }

  const contract = await erc721Contract(address, chain)
  if (!contract) {
    return 0
  }

  let b
  try {
    b = await contract.balanceOf(owner)
  } catch {}
  if (!b) {
    return 0
  } else {
    return b.toNumber()
  }
}

export const getOwnerOfToken_ERC721Contract = async (tokenId: string, address: string, chain = 1): Promise<string | null> => {
  if (!ethers.isAddress(address)) {
    return null
  }
  if (typeof tokenId !== 'string') {
    return null
  }

  const contract = await erc721Contract(address, chain)
  if (!contract) {
    return null
  }

  let b = null
  try {
    b = await contract.ownerOf(tokenId)
  } catch (e) {
    log.error('getOwnerOfToken_ERC721Contract: failed finding owner for ${token Id}', e)
  }

  return b
}

export const getBalanceOfToken_ERC1155Contract = async (owner: string, address: string, tokenId: string, chain = 1): Promise<number> => {
  if (!ethers.isAddress(address)) {
    return 0
  }
  if (!ethers.isAddress(owner)) {
    return 0
  }

  const contract = await erc1155Contract(address, chain)
  if (!contract) {
    return 0
  }
  let b
  try {
    b = await contract.balanceOf(owner, tokenId)
  } catch {}

  if (!b) {
    return 0
  } else {
    return b.toNumber()
  }
}

export const getTypeOfContract = async (address: string, chain = 1): Promise<'erc721' | 'erc1155' | 'erc20' | null> => {
  if (!ethers.isAddress(address)) {
    return null
  }
  const provider = chain == 1 ? ethAlchemy : polygonAlchemy

  const abi = [
    {
      inputs: [{ internalType: 'bytes4', name: 'interfaceId', type: 'bytes4' }],
      name: 'supportsInterface',
      outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
      stateMutability: 'view',
      type: 'function',
    },
  ]

  const erc20_ID = '0x36372b07'
  const erc721_ID = '0x80ac58cd'
  const erc1155_ID = '0xd9b67a26'

  const contract = new ethers.Contract(address, abi, provider)

  // FML, it's not like it's easy to handle errors
  const handleErr = (error: any) => {
    try {
      if (Array.isArray(error.results)) {
        error.results.forEach((res: any) => {
          let body = res.error.body
          try {
            body = JSON.parse(res.error.body)
          } catch (err) {}
          log.error(`error checking contract type ${res.error.status}`, body)
        })
      } else {
      }
    } catch (err) {
      log.error('unknown error checking contract type')
    }
  }

  let b = null
  try {
    b = await contract.supportsInterface(erc721_ID)
  } catch (err: any) {
    handleErr(err)
  }

  if (b) {
    return 'erc721'
  }

  let a = null
  try {
    a = await contract.supportsInterface(erc1155_ID)
  } catch (err: any) {
    handleErr(err)
  }

  if (a) {
    return 'erc1155'
  }

  let c = null
  try {
    c = await contract.supportsInterface(erc20_ID)
  } catch (err: any) {
    handleErr(err)
  }

  if (c) {
    return 'erc20'
  }

  //special case for Cryptopunks
  if (address?.toLowerCase() == '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB'.toLowerCase()) {
    return 'erc20'
  }
  return null
}

export const validateTokenType = (token: tokensToEnter): boolean => {
  if (!token.address || !ethers.isAddress(token.address)) {
    return false
  }
  if (!token.chain || typeof token.chain !== 'number') {
    return false
  }
  if (token.type == 'erc1155' && !token.tokenId) {
    return false
  }

  return true
}
