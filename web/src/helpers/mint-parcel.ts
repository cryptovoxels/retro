import { ethers } from 'ethers'
import PARCEL_CONTRACT_ABI from '../../../common/contracts/parcel.json'

// Parcels always mint to the Voxels team wallet at 0 ETH (same as the old in-world path).
const PARCEL = process.env.CONTRACT_ADDRESS || '0x79986aF15539de2db9A5086382daEdA917A9CF0C'
export const TEAM = '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'

export type Bounds = { id: number; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }

export async function parcelSigner() {
  console.log('[mint] parcelSigner: ethereum?', !!window.ethereum, 'CONTRACT', PARCEL)
  if (!window.ethereum) throw new Error('no window.ethereum - open MetaMask')
  const provider = new ethers.BrowserProvider(window.ethereum as any)
  const network = await provider.getNetwork()
  console.log('[mint] network', network.chainId.toString(), network.name)
  const signer = await provider.getSigner()
  console.log('[mint] signer', await signer.getAddress())
  return signer
}

export async function parcelContract() {
  const signer = await parcelSigner()
  const c = new ethers.Contract(PARCEL, (PARCEL_CONTRACT_ABI as any).abi, signer)
  console.log('[mint] contract ready', PARCEL)
  return c
}

export const sendMint = (c: ethers.Contract, p: Bounds) => {
  const args = [TEAM, p.id, p.x1, p.y1, p.z1, p.x2, p.y2, p.z2, ethers.parseEther('0')]
  console.log('[mint] sendMint calling contract.mint', { id: p.id, bounds: p, TEAM, price: '0' })
  return c.mint(...args).then(
    (tx: any) => {
      console.log('[mint] sendMint got tx', tx?.hash, tx)
      return tx
    },
    (err: any) => {
      console.error('[mint] sendMint REJECTED', err?.shortMessage || err?.message || err, err)
      throw err
    },
  )
}

export async function mintParcel(p: Bounds): Promise<string> {
  const tx = await sendMint(await parcelContract(), p)
  await tx.wait()
  return tx.hash
}
