import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import ParcelHelper from '../../../common/helpers/parcel-helper'
import { spaceW } from '../../../src/utils/space-w'
import cachedFetch from '../helpers/cached-fetch'
import { naviportHere } from '../helpers/coords-nav'
import { wompCache } from '../store'

export default function Teleport({ children }: { children: ComponentChildren }) {
  const latest = useRef(0)

  const onClick = async (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const link = (e.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
    const url = new URL(link.href)
    if (url.origin !== location.origin) return
    const parcel = url.pathname.match(/^\/parcels\/(\d+)(?:\/visit)?\/?$/)
    const womp = url.pathname.match(/^\/womps\/(\d+)\/?$/)
    const space = url.pathname.match(/^\/spaces\/([^/]+)(?:\/play)?\/?$/)
    let coords = url.searchParams.get('coords') || ''
    if (!parcel && !womp && !space && !(url.pathname === '/play' && coords)) return
    e.preventDefault()
    e.stopPropagation()
    const click = ++latest.current

    try {
      let spaceId = space?.[1]
      if (womp) {
        const shot = wompCache.get(`/womps/${womp[1]}`) || (await (await cachedFetch(`/api/womps/${womp[1]}.json`)).json()).womp
        if (!shot?.coords) return
        coords = shot.coords
        spaceId = shot.space_id
      } else if (parcel && !coords) {
        const data = await (await cachedFetch(`/api/parcels/${parcel[1]}.json`)).json()
        if (!data.parcel) return
        coords = new ParcelHelper(data.parcel).spawnCoords
      }
      if (click !== latest.current) return
      await window.grid?.switchWorld(spaceId ? spaceW(spaceId) : 0, spaceId, coords || undefined)
      if (click === latest.current && coords) naviportHere(coords)
    } catch (error) {
      console.error('Unable to teleport', error)
    }
  }

  return (
    <div class="teleport" style={{ display: 'contents' }} onClickCapture={onClick}>
      {children}
    </div>
  )
}
