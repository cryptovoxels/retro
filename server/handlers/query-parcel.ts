import Parcel from '../parcel'
// @ts-ignore
import fetch from 'node-fetch'
import { Request, Response } from 'express'
import log from '../lib/logger'

export default async function queryParcel(req: Request, res: Response) {
  const parcel_id = parseInt(req.params.id)
  if (isNaN(parcel_id)) {
    res.status(404).json({ success: false })
    return
  }
  const parcel = await Parcel.load(parcel_id)
  if (!parcel) {
    res.json({ success: false })
    return
  }

  await parcel.queryContract()

  res.json({ success: true, parcel })
}

export async function refreshParcelsByWallet(req: Request, res: Response) {
  if (!req.params.wallet) {
    res.status(404).json({ success: false })
    return
  }

  // Fetch the subgraph for list of parcels
  const p = await fetch(`${process.env.SUBGRAPHS_ROUTER}/api/parcels/${req.params.wallet}.json?force_update=true`)
  const r = await p.json()
  let parcels: {
    id: string
  }[] = []
  if (!r.success) {
    res.status(404).json({ success: false })
    return
  }

  parcels = r.parcels
  // If no parcels we send success false as a safe option, in case the Eth subgraph is being indexed and to avoid the user seeing no parcels
  // if he had any.
  if (parcels.length == 0) {
    res.json({ success: false })
    return
  }
  // Loop through the list to update all parcels. (we query the contract as a just-to-make-sure step.)
  for (const p of parcels) {
    const parcel = await Parcel.load(Number(p.id))
    if (!parcel) {
      continue
    }
    try {
      await parcel.queryContract()
    } catch (e) {
      log.error('error on parcel.queryContract', e)
      res.json({ success: false })
      return
    }
  }

  res.json({ success: true })
}
