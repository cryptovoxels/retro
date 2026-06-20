////////////////////////////////////////////////////
// Types for parcel features used in various APIs

import * as t from 'io-ts'
import { avatarRefCodec } from './avatar-ref'

// Atomic types

export const NullableNum = t.union([t.number, t.null])
export const UndefinableNum = t.union([t.number, t.undefined, t.literal('')])
export const NullableStr = t.union([t.string, t.null])
export const UndefinableStr = t.union([t.string, t.undefined])
export const NullableBool = t.union([t.boolean, t.null])
export const NumOrStr = t.union([t.number, t.string])

/**
 * A 3D vector in one of a number of formats
 */
export const Vec3Description = t.union([t.tuple([NullableNum, NullableNum, NullableNum]), t.type({ x: t.number, y: t.number, z: t.number })])
export type Vec3Description = t.TypeOf<typeof Vec3Description>

/**
 * A URL in one of a number of formats
 */
const UrlRecord = t.union([t.string, t.tuple([t.string]), t.type({ url: t.string }), t.null])

/**
 * A color in one of a number of formats
 */
const ColorRecord = t.union([t.string, t.tuple([t.number, t.number, t.number])])
export type ColorRecord = t.TypeOf<typeof ColorRecord>

// Supporting types

export const ImageMode = t.union([t.literal('Multiply'), t.literal('Screen'), t.literal('Combine'), t.literal('Combiner'), t.literal('屏幕')]) // 屏幕 is chinese for "Screen"
export type ImageMode = t.TypeOf<typeof ImageMode>

export const WrapMode = t.union([t.literal('Clamp'), t.literal('Repeat'), t.literal('Mirror')])
export type WrapMode = t.TypeOf<typeof WrapMode>

export const BlendMode = t.union([t.boolean, t.literal('AlphaBlend'), t.literal('AlphaTest'), t.literal('Ignore'), t.literal('Background')])
export type BlendMode = t.TypeOf<typeof BlendMode>

export const WompRecord = t.intersection(
  [
    t.type(
      {
        id: t.number,
        author: avatarRefCodec,
        content: t.string,
        parcel_id: t.union([t.number, t.null]),
        coords: t.string,
        created_at: t.string,
        updated_at: t.string,
        space_id: t.union([t.string, t.undefined, t.null]),
      },
      'core',
    ),
    t.partial(
      {
        parcel_address: NullableStr,
        parcel_name: NullableStr,
        space_name: NullableStr,
        image_url: t.string,
      },
      'optional',
    ),
  ],
  'WompRecord',
)
export type WompRecord = t.TypeOf<typeof WompRecord>

export const CollectibleInfoRecord = t.intersection(
  [
    t.type({
      chain_id: t.number,
      id: t.string,
      token_id: t.number,
      collection_id: t.number,
      name: t.string,
      description: t.string,
      hash: t.string,
      author: avatarRefCodec,
      category: t.union([t.string, t.undefined]),
      collection_name: t.string,
      collection_address: t.string,
    }),
    t.partial({
      quantity: t.number,
    }),
  ],
  'CollectibleInfoRecord',
)

export type CollectibleInfoRecord = t.TypeOf<typeof CollectibleInfoRecord>

export const KeyFrameValues = t.tuple([t.unknown, t.unknown, t.unknown])
export type KeyFrameValues = t.TypeOf<typeof KeyFrameValues>

export const KeyFrame = t.type({
  frame: t.union([t.number, t.null]),
  value: KeyFrameValues,
})
export type KeyFrame = t.TypeOf<typeof KeyFrame>

export const AnimationDestination = t.union([t.literal('rotation'), t.literal('position'), t.literal('scaling'), t.literal(''), t.null, t.undefined])
export type AnimationDestination = t.TypeOf<typeof AnimationDestination>

export const EasingDescription = t.union([
  t.type({
    function: t.string,
    mode: t.string,
  }),
  t.type({}),
  t.undefined,
])
export type EasingDescription = t.TypeOf<typeof EasingDescription>

// Inline behaviour: lua source lives on the feature. Pick a preset or have an LLM
// write one - behaviours never touch the asset library.
export const Behaviour = t.type({ name: t.string, code: t.string })
export type Behaviour = t.TypeOf<typeof Behaviour>

// Message descriptions for parcel features
export const FeatureCommon = t.intersection(
  [
    t.type(
      {
        type: t.string,
        rotation: Vec3Description,
        position: Vec3Description,
        scale: Vec3Description,
      },
      'core',
    ),
    t.partial(
      {
        uuid: t.string, // wow - this is, in fact, missing in some parcels (!)
        id: t.string,
        url: UrlRecord,
        createdByScripting: t.boolean,
        description: t.string,
        version: t.string,
        groupId: NullableStr,
        blendMode: ImageMode,
        inverted: t.boolean,
        proximityToTrigger: t.number,
        isTrigger: t.boolean,
        triggerIsAudible: t.boolean,
        link: NullableStr,
        script: NullableStr,
        behave: t.array(Behaviour),
        animation: t.type({
          destination: AnimationDestination,
          keyframes: t.array(KeyFrame),
          easing: EasingDescription,
        }),
      },
      'optional',
    ),
  ],
  'FeatureCommon',
)
export type FeatureCommon = t.TypeOf<typeof FeatureCommon>

const TYPE_SPECIFIC = 'type-specific'

export const SignRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('sign'),
    }),
    t.partial(
      {
        fontSize: NumOrStr,
        color: t.string,
        background: t.string,
        text: t.string,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'SignRecord',
)
export type SignRecord = t.TypeOf<typeof SignRecord>

export const CubeRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('cube'),
    }),
    t.partial(
      {
        color: t.string,
        specularColor: t.tuple([t.number, t.number, t.number]),
        collidable: t.boolean,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'CubeRecord',
)
export type CubeRecord = t.TypeOf<typeof CubeRecord>

export const AssetRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('asset'),
      link: t.string,
    }),
  ],
  'AssetRecord',
)
export type AssetRecord = t.TypeOf<typeof AssetRecord>

export const RichTextRecord = t.intersection(
  [
    FeatureCommon,
    t.type(
      {
        type: t.literal('richtext'),
        text: t.string,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'RichTextRecord',
)
export type RichTextRecord = t.TypeOf<typeof RichTextRecord>

export const ImageRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('image'),
    }),
    t.partial(
      {
        transparent: BlendMode,
        wrapMode: WrapMode,
        updateDaily: t.boolean,
        stretch: t.boolean,
        pixelated: t.boolean,
        uScale: NumOrStr,
        vScale: NumOrStr,
        opacity: NumOrStr,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'ImageRecord',
)
export type ImageRecord = t.TypeOf<typeof ImageRecord>

export const VidScreenRecord = t.intersection(
  [
    FeatureCommon,
    t.type(
      {
        type: t.literal('vid-screen'),
      },
      TYPE_SPECIFIC,
    ),
    t.partial({
      specularColor: t.tuple([t.number, t.number, t.number]),
    }),
  ],
  'VidScreenRecord',
)
export type VidScreenRecord = t.TypeOf<typeof VidScreenRecord>

export const VideoRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('video'),
    }),
    t.partial(
      {
        previewUrl: t.string,
        autoplay: t.boolean,
        loop: t.boolean,
        startAt: t.number,
        endAt: t.number,
        rolloffFactor: t.number,
        volume: t.number,
        assetUrl: NullableStr,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'VideoRecord',
)
export type VideoRecord = t.TypeOf<typeof VideoRecord>

export const YoutubeRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('youtube'),
    }),
    t.partial(
      {
        previewUrl: t.string,
        autoplay: t.boolean,
        inverted: t.boolean,
        rolloffFactor: t.number,
        screenRatio: t.string,
        volume: t.number,
        loop: t.boolean,
        broadcasting: t.boolean, // legacy: upgraded to showbox at load
      },
      TYPE_SPECIFIC,
    ),
  ],
  'YoutubeRecord',
)
export type YoutubeRecord = t.TypeOf<typeof YoutubeRecord>

export const ShowboxRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('showbox'),
    }),
    t.partial(
      {
        rolloffFactor: t.number,
        volume: t.number,
        guestMode: t.union([t.literal('solo'), t.literal('cohost')]),
        screenShape: t.union([t.literal('landscape'), t.literal('portrait')]),
        mirrorSource: t.union([t.literal('auto'), t.literal('host'), t.literal('collaborator'), t.literal('guest')]),
        angleMode: t.boolean,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'ShowboxRecord',
)
export type ShowboxRecord = t.TypeOf<typeof ShowboxRecord>

export const NftImageRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('nft-image'),
    }),
    t.partial(
      {
        transparent: BlendMode,
        hasGui: t.boolean,
        hasGuiResizable: t.boolean,
        hasFrame: t.boolean,
        nftFrameStyle: t.union([t.literal('classic'), t.literal('colors'), t.literal('blue')]),
        stretch: t.boolean,
        pixelated: t.boolean,
        emissiveColorIntensity: NumOrStr,
        parcelOwnerIsAssetOwner: t.boolean,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'NftImageRecord',
)
export type NftImageRecord = t.TypeOf<typeof NftImageRecord>

export const CollectibleModelRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('collectible-model'),
    }),
    t.partial(
      {
        collectible: CollectibleInfoRecord,
        tryRotation: t.array(t.number),
        tryBone: t.string,
        tryScale: t.array(t.number),
        tryPosition: t.array(t.number),
        tryable: t.boolean,
        showTryOnPopUp: t.boolean,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'CollectibleModelRecord',
)
export type CollectibleModelRecord = t.TypeOf<typeof CollectibleModelRecord>

export const AudioRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('audio'),
    }),
    t.partial(
      {
        sprite: t.unknown,
        autoplay: t.boolean,
        loop: t.unknown,
        streaming: t.boolean,
        rolloffFactor: t.number,
        volume: t.number,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'AudioRecord',
)
export type AudioRecord = t.TypeOf<typeof AudioRecord>

export const PolytextRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('polytext'),
    }),
    t.partial(
      {
        text: t.string,
        color: t.string,
        specularColor: t.tuple([t.number, t.number, t.number]),
        edges: t.boolean,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'PolytextRecord',
)
export type PolytextRecord = t.TypeOf<typeof PolytextRecord>

export const PolytextV2Record = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('polytext-v2'),
    }),
    t.partial(
      {
        text: t.string,
        color: t.string,
        emissiveColor: t.string,
        collidable: t.union([t.undefined, t.boolean]),
        specularColor: t.union([t.string, t.tuple([t.number, t.number, t.number])]),
        edges: t.boolean,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'PolytextRecord',
)
export type PolytextV2Record = t.TypeOf<typeof PolytextV2Record>

export const ButtonRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('button'),
    }),
    t.partial(
      {
        soundId: NumOrStr,
        color: t.string,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'ButtonRecord',
)
export type ButtonRecord = t.TypeOf<typeof ButtonRecord>

export const VoxCommonRecord = t.intersection(
  [
    FeatureCommon,
    t.partial(
      {
        collidable: t.boolean,
        cubescale: t.boolean,
      },
      'voxfields',
    ),
  ],
  'VoxCommonRecord',
)
export type VoxCommonRecord = t.TypeOf<typeof VoxCommonRecord>

export const VoxModelRecord = t.intersection(
  [
    VoxCommonRecord,
    t.type({
      type: t.literal('vox-model'),
    }),
  ],
  'VoxModelRecord',
)
export type VoxModelRecord = t.TypeOf<typeof VoxModelRecord>

export const MegavoxRecord = t.intersection(
  [
    VoxCommonRecord,
    t.type({
      type: t.literal('megavox'),
    }),
  ],
  'MegavoxRecord',
)

export type MegavoxRecord = t.TypeOf<typeof MegavoxRecord>

export const ParticlesRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('particles'),
    }),
    t.partial(
      {
        emitRate: NullableNum,
        minSize: NullableNum,
        maxSize: NullableNum,
        color1: ColorRecord,
        color2: ColorRecord,
        colorDead: t.string,
        opacityDead: NumOrStr,
        gravity: NumOrStr,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'ParticlesRecord',
)
export type ParticlesRecord = t.TypeOf<typeof ParticlesRecord>

export const BoomboxRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('boombox'),
    }),
    t.partial(
      {
        rolloffFactor: t.number,
        authBroadcast: t.boolean,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'BoomboxRecord',
)
export type BoomboxRecord = t.TypeOf<typeof BoomboxRecord>

export const TextInputRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('text-input'),
    }),
    t.partial(
      {
        specularColor: t.tuple([t.number, t.number, t.number]),
        placeholder: t.string,
      },
      TYPE_SPECIFIC,
    ),
  ],
  '',
)
export type TextInputRecord = t.TypeOf<typeof TextInputRecord>

export const SliderInputRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('slider-input'),
    }),
    t.partial(
      {
        text: t.string,
        minimum: t.number,
        maximum: t.number,
        specularColor: t.tuple([t.number, t.number, t.number]),
        default: t.number,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'SliderInputRecord',
)
export type SliderInputRecord = t.TypeOf<typeof SliderInputRecord>

export const LanternRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('lantern'),
    }),
    t.partial(
      {
        color: t.string,
        strength: NumOrStr,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'LanternRecord',
)
export type LanternRecord = t.TypeOf<typeof LanternRecord>

export const SpawnPointRecord = t.intersection(
  [
    FeatureCommon,
    t.type(
      {
        type: t.literal('spawn-point'),
      },
      TYPE_SPECIFIC,
    ),
  ],
  'SpawnPointRecord',
)
export type SpawnPointRecord = t.TypeOf<typeof SpawnPointRecord>

export const PortalRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('portal'),
    }),
    t.partial(
      {
        womp: WompRecord,
        playSound: t.boolean,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'PortalRecord',
)
export type PortalRecord = t.TypeOf<typeof PortalRecord>

export const PoapDispenserRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('poap-dispenser'),
    }),
    t.partial(
      {
        event_id: t.string,
        edit_code: t.string,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'PoapDispenserRecord',
)
export type PoapDispenserRecord = t.TypeOf<typeof PoapDispenserRecord>

export const GroupRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('group'),
    }),
  ],
  'GroupRecord',
)
export type GroupRecord = t.TypeOf<typeof GroupRecord>

export const GuestBookRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('guest-book'),
    }),
    t.partial(
      {
        signature_text: t.string,
        allowSignChatCommand: t.boolean,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'GuestBookRecord',
)
export type GuestBookRecord = t.TypeOf<typeof GuestBookRecord>

export const PoseBallRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('pose-ball'),
    }),
    t.partial(
      {
        pose: NumOrStr,
        text: t.string,
      },
      TYPE_SPECIFIC,
    ),
  ],
  'PoseBallRecord',
)
export type PoseBallRecord = t.TypeOf<typeof PoseBallRecord>

// deprecated fatures
export const ScreenRecord = t.intersection(
  [
    FeatureCommon,
    t.type({
      type: t.literal('screen'),
    }),
    t.partial({}, TYPE_SPECIFIC),
  ],
  'ScreenRecord',
)
export type ScreenRecord = t.TypeOf<typeof ScreenRecord>

// Multi-feature types based on capability

export const CollidableFeatureRecord = t.type(
  {
    collidable: t.boolean,
  },
  'CollidableFeatureRecord',
)
export type CollidableFeatureRecord = t.TypeOf<typeof CollidableFeatureRecord>

// Deprecated features that still exist in the database
// Keeping these as separate type-defs provides cleaner error messages
const DeprecatedScript = t.intersection([
  FeatureCommon,
  t.type({
    type: t.literal('script'),
  }),
])
const DeprecatedAnimationPlatform = t.intersection([
  FeatureCommon,
  t.type({
    type: t.literal('animation-platform'),
  }),
])
const DeprecatedVox = t.intersection([
  FeatureCommon,
  t.type({
    type: t.literal('vox'),
  }),
])

// Combined type

export const FeatureRecord = t.union(
  [
    AssetRecord,
    SignRecord,
    CubeRecord,
    PoapDispenserRecord,
    RichTextRecord,
    ImageRecord,
    VidScreenRecord,
    VideoRecord,
    YoutubeRecord,
    ShowboxRecord,
    NftImageRecord,
    CollectibleModelRecord,
    AudioRecord,
    PolytextRecord,
    PolytextV2Record,
    ButtonRecord,
    VoxModelRecord,
    MegavoxRecord,
    ParticlesRecord,
    BoomboxRecord,
    TextInputRecord,
    SliderInputRecord,
    LanternRecord,
    SpawnPointRecord,
    PortalRecord,
    GroupRecord,
    GuestBookRecord,
    PoseBallRecord,
    ScreenRecord,
    DeprecatedScript,
    DeprecatedAnimationPlatform,
    DeprecatedVox,
  ],
  'FeatureRecord',
)
export type FeatureRecord = t.TypeOf<typeof FeatureRecord>

export type FeatureType = FeatureRecord['type']

type NonMeshedFeatureType = GroupRecord['type'] | PolytextRecord['type'] | PolytextV2Record['type']

type MeshedFeatureType = Exclude<FeatureType, NonMeshedFeatureType>

export type MeshedFeatureRecord = FeatureRecord & { type: MeshedFeatureType }

export type NonMeshedFeatureRecord = FeatureRecord & { type: NonMeshedFeatureType }
