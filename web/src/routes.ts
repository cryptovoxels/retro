type RouteDef = {
  path: string
  component?: string
  server?: string | false
  cache?: string | false
  useRoute?: boolean
}

const duration = '10 minutes'

export const routes: RouteDef[] = [
  { path: '/', component: 'explore', server: false },
  { path: '/blog', component: 'blog' },
  { path: '/blog/:slug', component: 'post' },
  { path: '/chat', component: 'chat' },
  { path: '/menu', component: 'menu' },
  { path: '/terms', component: 'terms', server: false },
  { path: '/privacy', component: 'privacy', server: false },
  { path: '/conduct', component: 'conduct', server: false },
  { path: '/behaviours', component: 'behaviours', server: false },
  { path: '/logout', component: 'logout', cache: false },
  { path: '/not-found', component: 'notFound', server: false },
  { path: '/mail', component: 'mail' },
  { path: '/search', component: 'search' },
  { path: '/assets', component: 'assets' },
  { path: '/assets/new', component: 'assetsNew' },
  { path: '/assets/:id', component: 'asset' },
  { path: '/assets/:id/edit', component: 'editAsset' },
  { path: '/assets/:id/render', component: 'renderAsset' },
  { path: '/u/:wallet/assets', component: 'assets' },
  { path: '/parcels', component: 'parcels', server: false },
  { path: '/parcels/:id', component: 'parcel', server: false },
  { path: '/parcels/:id/:section', component: 'parcel' },
  { path: '/parcels/:id/edit', component: 'parcelEdit' },
  { path: '/spaces', component: 'spaces', cache: duration },
  { path: '/spaces/new', component: 'newSpace' },
  { path: '/spaces/:id', component: 'space', server: false },
  { path: '/spaces/:id/edit', component: 'spaceEdit' },
  { path: '/islands', component: 'islands' },
  { path: '/islands/:slug', component: 'island', server: '/islands/:id' },
  { path: '/map', component: 'map' },
  { path: '/golive/broadcast', component: 'goLiveBroadcast', useRoute: true },
  { path: '/golive', component: 'goLive', useRoute: true },
  { path: '/costumes/:id/render', component: 'renderCostume' },
  { path: '/avatar/:walletOrName', component: 'avatar', server: false },
  { path: '/avatar/:walletOrName/:tab?', component: 'avatar', server: false },
  { path: '/u/:walletOrName', component: 'avatar', server: false },
  { path: '/u/:walletOrName/:tab?', component: 'avatar', server: false },
  { path: '/costumer', component: 'costumer', server: '/costumer/' },
  { path: '/costumer/:costumeId', component: 'costumer', server: '/costumer/:id' },
  { path: '/collections', component: 'collections', cache: '30 seconds' },
  { path: '/collections/new', component: 'collectionsNew', server: '/collections/*', cache: '30 seconds' },
  { path: '/collections/:id/edit', component: 'collectionEdit', server: '/collections/*', cache: '30 seconds' },
  { path: '/collections/:id', component: 'collection', server: '/collections/*', cache: '30 seconds' },
  { path: '/collections/:cid/:address/:tid', component: 'wearable', server: '/collections/*', cache: '30 seconds' },
  { path: '/womps/:id', component: 'womp', server: false },
  { path: '/events/:id', component: 'eventPage', server: '/events/*' },
  { path: '/events/new', component: 'eventsNew', server: '/events/*' },
  { path: '/events/:id/edit', component: 'eventsEdit', server: '/events/*' },
  { path: '/events', component: 'events' },
  { path: '/shop', component: 'shop' },
  { path: '/womps', component: 'womps' },
  { path: '/propose/islands', component: 'islandsAdmin', server: '/propose/*' },
  { path: '/admin', component: 'admin' },
  { path: '/home', server: '/home' },
  { path: '/login', server: '/login' },
  { path: '/account', server: '/account' },
  { path: '/account/edit', server: '/account/edit' },
  { path: '/account/:section', server: '/account/:section', cache: '30 seconds' },
  { path: '/community', server: '/community' },
  { path: '/new', server: '/new' },
  { path: '/avatar', server: '/avatar' },
  { path: '/costumes/', server: '/costumes/', cache: '30 seconds' },
  { path: '/metrics', server: '/metrics', cache: false },
  { path: '/radio', server: '/radio' },
  { path: '/scratchpad', server: '/scratchpad' },
]

type ShellRoute = { path: string; cache: string | false }

export const shellRoutes: ShellRoute[] = (() => {
  const seen = new Set<string>()
  const out: ShellRoute[] = []
  for (const r of routes) {
    if (r.server === false) continue
    const path = typeof r.server === 'string' ? r.server : r.path
    if (seen.has(path)) continue
    seen.add(path)
    out.push({ path, cache: r.cache ?? '1 minute' })
  }
  return out
})()
