import { route } from 'preact-router'
import { focusFirst } from './keynav'
import { teleportToLatestWomp } from './latest-womp'

export const FOCUS_EXPLORE = 'focus-explore'

export function openExplore() {
  if (typeof location !== 'undefined' && location.pathname === '/') {
    // already home: Explore does not remount, so snap back to the latest womp from here
    void teleportToLatestWomp()
    focusFirst('.explorer')
    return
  }
  try {
    sessionStorage.setItem(FOCUS_EXPLORE, '1')
  } catch {}
  route('/')
}
