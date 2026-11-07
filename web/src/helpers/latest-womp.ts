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

/** The front page always drops you at the latest womp - on cold load and every time you come back to /. */
export async function teleportToLatestWomp() {
  if (getCoords()) return // explicit share link wins
  const path = location.pathname
  const womp = await latestWomp()
  if (!womp) return
  await worldBoot()
  if (location.pathname !== path) return
  await window.grid?.switchWorld(0)
  if (location.pathname === path) await naviportHere(womp.coords)
}
