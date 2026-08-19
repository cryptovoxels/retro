import { route } from 'preact-router'
import { focusFirst } from './keynav'

export const FOCUS_EXPLORE = 'focus-explore'

export function openExplore() {
  if (typeof location !== 'undefined' && location.pathname === '/') {
    focusFirst('.explorer')
    return
  }
  try {
    sessionStorage.setItem(FOCUS_EXPLORE, '1')
  } catch {}
  route('/')
}
