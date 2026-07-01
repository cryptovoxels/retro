import Audio from './audio'
import Boombox from './boombox'
import Button from './button'
import Cube from './cube'
import GuestBook from './guest-book'
import PoapDispenser from './poap-dispenser'
import PoseBall from './pose-ball'
import Image from './image'
import Lantern from './lantern'
import VoxModel, { Megavox } from './vox-model'
import NftImage from './nft-image'
import CollectibleModel from './collectible-model'
import ParticleSystem from './particle-system'
import Polytext from './polytext'
import Portal from './portal'
import Richtext from './richtext'
import Sign from './sign'
import SpawnPoint from './spawn-point'
import TextInput from './text-input'
import SliderInput from './slider-input'
import Video from './video'
import VidScreen from './vid-screen'
import Showbox from './showbox'
import Youtube from './youtube'
import { FeatureType } from '../../common/messages/feature'
import Group from './group'
import Asset from './asset'

export const featuresInfo: FeatureMetadata[] = [
  Audio.metadata,
  Boombox.metadata,
  Showbox.metadata,
  Button.metadata,
  Cube.metadata,
  GuestBook.metadata,
  Image.metadata,
  Lantern.metadata,
  Megavox.metadata,
  NftImage.metadata,
  CollectibleModel.metadata,
  ParticleSystem.metadata,
  Polytext.metadata,
  PoseBall.metadata,
  Portal.metadata,
  Richtext.metadata,
  Sign.metadata,
  SpawnPoint.metadata,
  Video.metadata,
  VoxModel.metadata,
  Youtube.metadata,
]

// this data is used to give a feature it's first properties in the description
export const featureTemplates: Record<PlaceableFeatureTypes, FeatureTemplate> = {
  asset: Asset.template,
  audio: Audio.template,
  button: Button.template,
  sign: Sign.template,
  image: Image.template,
  'nft-image': NftImage.template,
  'collectible-model': CollectibleModel.template,
  'vox-model': VoxModel.template,
  cube: Cube.template,
  megavox: Megavox.template,
  lantern: Lantern.template,
  boombox: Boombox.template,
  showbox: Showbox.template,
  'guest-book': GuestBook.template,
  'poap-dispenser': PoapDispenser.template,
  'spawn-point': SpawnPoint.template,
  'text-input': TextInput.template,
  'slider-input': SliderInput.template,
  polytext: Polytext.template,
  'pose-ball': PoseBall.template,
  portal: Portal.template,
  richtext: Richtext.template,
  video: Video.template,
  'vid-screen': VidScreen.template,
  youtube: Youtube.template,
  particles: ParticleSystem.template,
  group: Group.template,
}

// these are the features that can be placed by the user
export type PlaceableFeatureTypes = Exclude<FeatureType, 'animation-platform' | 'script' | 'polytext-v2' | 'vox' | 'screen'>

// Used to display info about the Feature in the add tab
export type FeatureMetadata = {
  title: string
  subtitle: string
  type: PlaceableFeatureTypes
  image: string
  modOnly?: boolean
}

// When a feature is added to a parcel, these templates describes initial values
export type FeatureTemplate = {
  type: PlaceableFeatureTypes
  scale: [number, number, number]
  text?: string
  url?: string
  blendMode?: string
  transparencyMode?: string
  flipX?: boolean
  rotation?: [number, number, number]
  color?: string
  rotate?: number[]
  color1?: string
  color2?: string
  colorDead?: string
  opacityDead?: number
  gravity?: number
  signature_text?: string // Used by guest book
  animation?: unknown // todo: define animation
  children?: FeatureTemplate[] // used for when replicating group, BUT IS NOT SAVED ON THE PROPERTIES TABLE (Only in asset_library)
  position?: number[] // used for children of groups
  script?: string
  // Womps in portals
  womp?: any
  // Collectible in collectibleModel
  collectible?: any
  // try positions in collectibleModel
  tryable?: boolean
  tryPosition?: number[]
  tryRotation?: number[]
  tryScale?: number[]
  tryBone?: string
}
