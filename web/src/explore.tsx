import { Component, Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { currentVersion } from '../../common/version'
import Head from './components/head'
import { getClientPath } from './helpers/client-helpers'
import { getCoords, naviportHere } from './helpers/coords-nav'
import { WorldAside } from './world-aside'
import cachedFetch from './helpers/cached-fetch'
import { app, AppEvent } from './state'

function busiestParcel(): Promise<number | null> {
  return new Promise((resolve) => {
    const es = new EventSource('/api/users/live')
    const done = (id: number | null) => {
      clearTimeout(t)
      es.close()
      resolve(id)
    }
    const t = setTimeout(() => done(null), 3000)
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type !== 'snapshot') return
        const counts = new Map<number, number>()
        for (const u of msg.users ?? []) {
          if (u.parcel == null) continue
          counts.set(u.parcel, (counts.get(u.parcel) ?? 0) + 1)
        }
        let best: number | null = null
        let n = 0
        for (const [id, c] of counts) {
          if (c > n) {
            n = c
            best = id
          }
        }
        done(best)
      } catch {
        done(null)
      }
    }
    es.onerror = () => done(null)
  })
}

async function popularParcel(): Promise<number | null> {
  try {
    const r = await cachedFetch('/api/metrics/popular')
    const data = await r.json()
    if (!data.ok) return null
    return data.metrics?.[0]?.parcel?.id ?? null
  } catch {
    return null
  }
}

async function pickFrontpageParcel() {
  if (getCoords()) return
  const id = (await busiestParcel()) ?? (await popularParcel())
  if (!id) return
  const url = await new ParcelHelper({ id }).spawnUrl()
  naviportHere(url, id)
}

function HomeExplore() {
  const [node, setNode] = useState<ComponentChildren>(null)
  useEffect(() => {
    let live = true
    let timer = 0
    void import('../../src/ui/explorer').then(({ ExplorerUI }) => {
      const mount = () => {
        if (!live) return
        if (!window.scene) {
          timer = window.setTimeout(mount, 100)
          return
        }
        setNode(<ExplorerUI scene={window.scene} autoFocusSearch={false} />)
      }
      mount()
    })
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [])
  return <>{node}</>
}

export default class Explore extends Component<{}> {
  componentDidMount() {
    app.on(AppEvent.Logout, this.rerender)
    app.on(AppEvent.Login, this.rerender)
    void pickFrontpageParcel()
  }

  rerender = () => {
    this.forceUpdate()
  }

  componentWillUnmount() {
    app.off(AppEvent.Login, this.rerender)
    app.off(AppEvent.Logout, this.rerender)
  }

  render() {
    return (
      <Fragment>
        <Head title="Voxels (formerly Cryptovoxels)" url={'/'}>
          <Fragment>
            <link rel="prefetch" href={getClientPath(currentVersion)} />
            <link rel="prefetch" href="/api/parcels/cached.json" />
            <link rel="prefetch" href="/api/parcels/map.json" />
          </Fragment>
        </Head>

        <section class="columns home">
          <article>
            <div class="client-slot" />
          </article>
          <WorldAside>
            <HomeExplore />
          </WorldAside>
        </section>
      </Fragment>
    )
  }
}
