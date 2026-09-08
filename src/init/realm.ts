import cachedFetch from '../../web/src/helpers/cached-fetch'
import { encodeCoords } from '../../common/helpers/utils'
import { cameraRotation } from '../utils/camera'
import { isSpacePath } from '../../web/src/helpers/coords-nav'

let savedCoords: string | undefined

export function realmSavedCoords() {
  return savedCoords
}

export function saveRealmCoords() {
  if (!window.persona || !window.scene?.activeCamera) return
  if (window.persona.position.y < -10) return
  savedCoords = encodeCoords({
    position: window.persona.position.clone(),
    rotation: cameraRotation(window.scene),
  })
}

export function pushSpaceHistory(spaceId: string) {
  saveRealmCoords()
  const push = (history as any).oldPushState?.bind(history) ?? history.pushState.bind(history)
  push({ realm: 'space', savedCoords }, '', `/spaces/${spaceId}/play`)
}

export function setupRealmPopstate() {
  window.addEventListener('popstate', () => {
    if (isSpacePath(location.pathname)) return
    if (window.grid?.currentW === 0) return
    void window.grid?.switchWorld(0, undefined, realmSavedCoords())
  })
}

export async function fetchSpace(id: string) {
  const r = await cachedFetch(`/api/spaces/${id}.json`)
  const data = await r.json()
  return data?.space ?? null
}
