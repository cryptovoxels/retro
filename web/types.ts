export enum WearableCategory {
  Accessory = 'accessory',
  Headwear = 'headwear',
  Facewear = 'facewear',
  Upperbody = 'upperbody',
  Lowerbody = 'lowerbody',
  Feet = 'feet',
  Arms = 'arms',
  Hands = 'hands',
}

export function defaultBone(wearable: any | { category: WearableCategory }) {
  switch (wearable?.category) {
    case WearableCategory.Accessory:
      return 'Neck'
    case WearableCategory.Facewear:
      return 'Head'
    case WearableCategory.Arms:
      return 'RightArm'
    case WearableCategory.Feet:
      return 'RightFoot'
    case WearableCategory.Hands:
      return 'RightHand'
    case WearableCategory.Headwear:
      return 'HeadTop_End'
    case WearableCategory.Lowerbody:
      return 'LeftUpLeg'
    case WearableCategory.Upperbody:
      return 'Spine1'
    default:
      return 'Head'
  }
}
