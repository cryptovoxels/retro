import { ComponentType } from 'preact'
import { Route } from 'preact-router'
import GoLive from '../account/go-live'
import GoLiveBroadcast from '../account/go-live-broadcast'
import Asset from './asset'
import Assets from './assets'
import AssetsNew from './assets-new'
import ApiDoc from './api-doc'
import ArtDoc from './art-doc'
import BehavioursDoc from './behaviours-doc'
import Blog from './blog'
import PostPage from './post'
import EditAsset from './assets/edit'
import Avatar from './avatar'
import Costumer from './costumer'
import CollectionEditPage from './collection-edit'
import CollectionPage from './collection'
import Collections from './collections'
import CollectionsNew from './collections-new'
import Conduct from './conduct'
import EventPage from './event-page'
import Events from './events'
import EventsNew from './events-new'
import EventsEdit from './events-edit'
import Explore from './explore'
import Logout from './logout'
import Island from './island'
import Islands from './islands'
import WorldMap from './map'
import Parcel from './parcel'
import ParcelEdit from './parcel-edit'
import Parcels from './parcels'
import Privacy from './privacy'
import RenderAsset from './render/asset'
import RenderCostume from './render/costume'
import Search from './search'
import Shop from './shop'
import Space from './space'
import IslandImport from './island-import'
import BuildPage from './build'
import Terms from './terms'
import Wearable from './wearable'
import Womp from './womp'
import WompsPage from './womps'
import IslandsAdmin from './admin/islands'
import Admin from './admin/admin'
import NotFound from './not-found'
import { ChatPage } from './chat-page'
import { routes } from './routes'

const components: Record<string, ComponentType<any>> = {
  explore: Explore,
  blog: Blog,
  post: PostPage,
  chat: ChatPage,
  terms: Terms,
  privacy: Privacy,
  conduct: Conduct,
  behaviours: BehavioursDoc,
  art: ArtDoc,
  apiDoc: ApiDoc,
  logout: Logout,
  notFound: NotFound,
  search: Search,
  assets: Assets,
  assetsNew: AssetsNew,
  asset: Asset,
  editAsset: EditAsset,
  renderAsset: RenderAsset,
  parcels: Parcels,
  parcel: Parcel,
  parcelEdit: ParcelEdit,
  space: Space,
  islandImport: IslandImport,
  build: BuildPage,
  islands: Islands,
  island: Island,
  map: WorldMap,
  goLiveBroadcast: GoLiveBroadcast,
  goLive: GoLive,
  renderCostume: RenderCostume,
  avatar: Avatar,
  costumer: Costumer,
  collections: Collections,
  collectionsNew: CollectionsNew,
  collectionEdit: CollectionEditPage,
  collection: CollectionPage,
  wearable: Wearable,
  womp: Womp,
  eventPage: EventPage,
  eventsNew: EventsNew,
  eventsEdit: EventsEdit,
  events: Events,
  shop: Shop,
  womps: WompsPage,
  islandsAdmin: IslandsAdmin,
  admin: Admin,
}

export function AppRoutes() {
  return routes
    .filter((r) => r.component && components[r.component])
    .map((r) => {
      const C = components[r.component!]
      if (r.useRoute) return <Route key={r.path} path={r.path} component={C} />
      return <C key={r.path} path={r.path} />
    })
}
