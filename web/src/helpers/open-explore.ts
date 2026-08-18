import { route } from 'preact-router'
import { focusFirst } from '../../../src/ui/keynav'
import { isFullClientPath } from './coords-nav'

export const FOCUS_EXPLORE = 'focus-explore'

export function openExplore() {
  if (typeof location !== 'undefined' && location.pathname === '/') {
    focusFirst('.explorer')
    return
  }
  try {
    sessionStorage.setItem(FOCUS_EXPLORE, '1')
  } catch {}
  // WorldSidebar unmounts <Router> on /play, so route() never swaps the page
  if (isFullClientPath(location.pathname)) {
    window.location.assign('/')
    return
  }
  route('/')
}
