import { ethers } from 'ethers'
import PARCEL_CONTRACT_ABI from '../../../common/contracts/parcel.json'

// Parcels always mint to the Voxels team wallet at 0 ETH (same as the old in-world path).
const PARCEL = process.env.CONTRACT_ADDRESS || '0x79986aF15539de2db9A5086382daEdA917A9CF0C'
export const TEAM = '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'

export type Bounds = { id: number; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }

export async function parcelSigner() {
  const provider = new ethers.BrowserProvider(window.ethereum as any)
  return provider.getSigner()
}

export async function parcelContract() {
  return new ethers.Contract(PARCEL, (PARCEL_CONTRACT_ABI as any).abi, await parcelSigner())
}

export const sendMint = (c: ethers.Contract, p: Bounds) => c.mint(TEAM, p.id, p.x1, p.y1, p.z1, p.x2, p.y2, p.z2, ethers.parseEther('0'))

export async function mintParcel(p: Bounds): Promise<string> {
  const tx = await sendMint(await parcelContract(), p)
  await tx.wait()
  return tx.hash
}
