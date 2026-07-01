// Circular referencies ahoy!
import Audio from './audio'
import Boombox from './boombox'
import Button from './button'
import Cube from './cube'
import Portal from './portal'
import Group from './group'
import Feature from './feature'
import Image from './image'
import Lantern from './lantern'
import NftImage from './nft-image'
import CollectibleModel from './collectible-model'
import ParticleSystem from './particle-system'
import Polytext from './polytext'
import Richtext from './richtext'
import Sign from './sign'
import SpawnPoint from './spawn-point'
import TextInput from './text-input'
import SliderInput from './slider-input'
import Video from './video'
import VidScreen from './vid-screen'
import VoxModel, { Megavox } from './vox-model'
import Showbox from './showbox'
import Youtube from './youtube'
import GuestBook from './guest-book'
import PoseBall from './pose-ball'
import { FeatureRecord, FeatureType, YoutubeRecord } from '../../common/messages/feature'
import PoapDispenser from './poap-dispenser'
import Parcel from '../parcel'
import { Unhandled } from './unhandled'
import { featureTemplates } from './_metadata'

export const createFeature = (scene: BABYLON.Scene, parcel: Parcel, uuid: string, description: FeatureRecord): Feature => {
  switch (description.type) {
    case 'sign':
      return new Sign(scene, parcel, uuid, description)
    case 'cube':
      return new Cube(scene, parcel, uuid, description)
    case 'richtext':
      return new Richtext(scene, parcel, uuid, description)
    case 'image':
      return new Image(scene, parcel, uuid, description)
    case 'vid-screen':
      return new VidScreen(scene, parcel, uuid, description)
    case 'video':
      return new Video(scene, parcel, uuid, description)
    case 'youtube': {
      const desc = description as YoutubeRecord
      if (desc.broadcasting) {
        const { broadcasting: _b, ...rest } = desc
        return new Showbox(scene, parcel, uuid, { ...rest, type: 'showbox' })
      }
      return new Youtube(scene, parcel, uuid, description)
    }
    case 'showbox':
      return new Showbox(scene, parcel, uuid, description)
    case 'nft-image':
      return new NftImage(scene, parcel, uuid, description)
    case 'collectible-model':
      return new CollectibleModel(scene, parcel, uuid, description)
    case 'audio':
      return new Audio(scene, parcel, uuid, description)
    case 'polytext':
    case 'polytext-v2':
      return new Polytext(scene, parcel, uuid, description)
    case 'button':
      return new Button(scene, parcel, uuid, description)
    case 'vox-model':
      return new VoxModel(scene, parcel, uuid, description)
    case 'poap-dispenser':
      return new PoapDispenser(scene, parcel, uuid, description)
    case 'megavox':
      return new Megavox(scene, parcel, uuid, description)
    case 'particles':
      return new ParticleSystem(scene, parcel, uuid, description)
    case 'boombox':
      return new Boombox(scene, parcel, uuid, description)
    case 'text-input':
      return new TextInput(scene, parcel, uuid, description)
    case 'slider-input':
      return new SliderInput(scene, parcel, uuid, description)
    case 'lantern':
      return new Lantern(scene, parcel, uuid, description)
    case 'spawn-point':
      return new SpawnPoint(scene, parcel, uuid, description)
    case 'portal':
      return new Portal(scene, parcel, uuid, description)
    case 'group':
      return new Group(scene, parcel, uuid, description)
    case 'guest-book':
      return new GuestBook(scene, parcel, uuid, description)
    case 'pose-ball':
      return new PoseBall(scene, parcel, uuid, description)

    default:
      // There are a number of deprecated feature that will drop into this. Seem common/messages/features.ts for the full list
      return new Unhandled(scene, parcel, uuid, description)
  }
}

const FEATURE_2D_AXES = [BABYLON.Axis.X, BABYLON.Axis.Z]
const FEATURE_3D_AXES = [BABYLON.Axis.Y]

export const getAxes = (type?: FeatureType) => {
  switch (type) {
    case 'group':
    case 'polytext':
    case 'polytext-v2':
    case 'vox-model':
    case 'collectible-model':
    case 'megavox':
    case 'boombox':
    case 'cube':
    case 'portal':
    case 'spawn-point':
    case 'button':
    case 'guest-book':
    case 'particles':
    case 'pose-ball':
      return FEATURE_3D_AXES
    case 'sign':
    case 'richtext':
    case 'video':
    case 'nft-image':
    case 'image':
    case 'audio':
    case 'slider-input':
      return FEATURE_2D_AXES
    default:
      return FEATURE_2D_AXES
  }
}

/**
 * Returns a nudge to use to set the feature's pivot point at the bottom.
 * Only needed for features who's pivot point is not at the bottom- otherwise, default 0
 * all non-bottom pivot features (except lantern) have the pivot in the middle- and can get the value by consuming featureTemplate scale Y
 * @param type 'vox-model'...
 * @param scale Optional, The scale given here is only required if it is more accurate than the featureTemplate.
 * @returns number
 */
export const pivotToBottomOfBoundingBoxDefault = (type: FeatureType, scale?: number[]): number => {
  switch (type) {
    case 'cube':
    case 'nft-image':
    case 'image':
    case 'audio':
    case 'portal':
    case 'richtext':
    case 'sign':
    case 'text-input':
    case 'guest-book':
    case 'slider-input':
    case 'video':
    case 'vid-screen':
    case 'youtube':
    case 'showbox':
      // for all of the above, pivot is in the centre
      return scale ? scale[1] / 2 : featureTemplates[type].scale[1] / 2
    case 'lantern':
      // for lantern, pivot appears to be 1/4 the way up.
      // Not sure if this is exactly correct- but looks about right.
      return featureTemplates[type].scale[1] / 4
    case 'group':
      // special case: Groups pivot point can only be determined (accurately) by the bounding box
      return scale ? scale[1] / 2 : 0
    default:
      // all other features, pivot is at the bottom
      return 0
  }
}
