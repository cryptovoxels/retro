import { Seaport } from '@opensea/seaport-js'
import { ItemType } from '@opensea/seaport-js/lib/constants'
import { ethers } from 'ethers'

const PARCEL = process.env.CONTRACT_ADDRESS || '0x79986aF15539de2db9A5086382daEdA917A9CF0C'
const DAY = 86400

export type Fee = { recipient: string; bps: number }

// Build + sign a fixed-price Seaport listing in the browser (handles the conduit
// approval tx), then hand the signed order to our server to post to OpenSea.
export async function listOnOpensea(tokenId: number, priceEth: string, fees: Fee[]): Promise<void> {
  const provider = new ethers.BrowserProvider(window.ethereum as any)
  const signer = await provider.getSigner()
  const offerer = await signer.getAddress()
  const seaport = new Seaport(signer)

  const { executeAllActions } = await seaport.createOrder(
    {
      offer: [{ itemType: ItemType.ERC721, token: PARCEL, identifier: String(tokenId) }],
      consideration: [{ amount: ethers.parseEther(priceEth).toString(), recipient: offerer }],
      fees: fees.map((f) => ({ recipient: f.recipient, basisPoints: f.bps })),
      endTime: String(Math.floor(Date.now() / 1000) + 30 * DAY),
    },
    offerer,
  )
  // runs the setApprovalForAll tx (if needed) then signs the order
  const order = await executeAllActions()

  const protocol_address = await seaport.contract.getAddress()
  const r = await fetch(`/api/admin/parcels/${tokenId}/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parameters: order.parameters, signature: order.signature, protocol_address }),
  })
  const d = await r.json()
  if (!d.success) throw new Error(d.message || 'opensea rejected the listing')
}
