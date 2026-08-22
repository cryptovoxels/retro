import { ethers } from 'ethers'
import { MetaMaskInpageProvider } from '@metamask/providers'
import FACTORY_ABI from '../../../common/contracts/collections-factory.json'
import COLLECTIBLE_ABI from '../../../common/contracts/collectibles-v2.json'
import { changeNetwork } from '../auth/login-helper'
import { fetchOptions } from '../utils'

const FACTORY = process.env.COLLECTION_FACTORY_CONTRACT_MATIC || '0x4CDaA2492BFF9793d0F39F222dEF7E364e620eC1'
const POLYGON = 137

async function polygonSigner() {
  if (!window.ethereum) throw new Error('no window.ethereum - open MetaMask')
  const provider = window.ethereum as MetaMaskInpageProvider
  const switched = await changeNetwork(provider, POLYGON)
  if (!switched.success) throw new Error(switched.error || 'switch to polygon')
  const browser = new ethers.BrowserProvider(window.ethereum as any)
  return browser.getSigner()
}

export async function deployCollection(collectionId: number, name: string): Promise<string> {
  const signer = await polygonSigner()
  const factory = new ethers.Contract(FACTORY, (FACTORY_ABI as any).abi, signer)
  const tx = await factory.launchCollection(collectionId, name)
  const receipt = await tx.wait()

  let address: string | null = null
  for (const log of receipt.logs || []) {
    try {
      const parsed = factory.interface.parseLog({ topics: log.topics as string[], data: log.data })
      if (parsed?.name === 'NewCollectionCreated') {
        address = parsed.args.collection || parsed.args[0]
        break
      }
    } catch {
      // not our event
    }
  }
  if (!address) {
    address = await factory.getCollectionFromId(collectionId)
  }
  if (!address || !ethers.isAddress(address)) throw new Error('deploy succeeded but no address')

  const r = await fetch(`/api/collections/${collectionId}/deployed`, {
    ...fetchOptions(),
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  }).then((x) => x.json())
  if (!r.success) throw new Error(r.message || 'failed to save address')
  return ethers.getAddress(address)
}

export async function mintWearable(collectionAddress: string, wearableUuid: string, quantity: number): Promise<number> {
  if (quantity < 1 || quantity > 9) throw new Error('quantity must be 1-9')
  const signer = await polygonSigner()
  const to = await signer.getAddress()
  const contract = new ethers.Contract(collectionAddress, (COLLECTIBLE_ABI as any).abi, signer)
  const tx = await contract.mint(to, quantity, '0x')
  const receipt = await tx.wait()

  let tokenId: number | null = null
  const iface = contract.interface
  for (const log of receipt.logs || []) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
      if (parsed?.name === 'TransferSingle') {
        // TransferSingle(operator, from, to, id, value)
        tokenId = Number(parsed.args.id ?? parsed.args[3])
        break
      }
    } catch {
      // not our event
    }
  }
  if (tokenId == null || isNaN(tokenId)) throw new Error('mint succeeded but no token id')

  const r = await fetch(`/api/wearables/${wearableUuid}/minted`, {
    ...fetchOptions(),
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_id: tokenId, issues: quantity }),
  }).then((x) => x.json())
  if (!r.success) throw new Error(r.message || 'failed to save mint')
  return tokenId
}
