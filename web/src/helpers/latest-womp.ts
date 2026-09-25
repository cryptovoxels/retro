import type { Womp } from '../tiles/womp-tile'
import { worldBoot } from '../client'
import cachedFetch from './cached-fetch'
import { getCoords, naviportHere } from './coords-nav'

/** Newest open-world womp (space womps skipped: teleporting there would route away from /). */
async function latestWomp(): Promise<Womp | null> {
  try {
    // same URL as the front page WompsList, so this shares its cache entry
    const r = await cachedFetch('/api/womps.json')
    const d = await r.json()
    return (d.womps as Womp[] | undefined)?.find((w) => w.coords && !w.space_id) ?? null
  } catch {
    return null
  }
}

/**
 * Client.syncRealm runs grid.switchWorld after boot (cold load, or coming back from
 * /spaces/:id/play) and that ends with its own spawn - naviporting before it finishes gets undone.
 */
async function untilOpenWorld(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (!window.grid?.openWorldReady && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** The front page always drops you at the latest womp - on cold load and every time you come back to /. */
export async function teleportToLatestWomp() {
  if (getCoords()) return // explicit share link wins
  const womp = await latestWomp()
  if (!womp) return
  await worldBoot()
  await untilOpenWorld()
  naviportHere(womp.coords)
}
