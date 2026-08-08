/**
 * Flat wall features: screens/images that sit on a plane and use
 * face-drag + corner resize + Z-depth (not XYZ arrows).
 *
 * Add a type here when it should get the same in-world edit tools as showbox.
 */
export const FLAT_WALL_FEATURE_TYPES = ['showbox', 'image', 'nft-image', 'video', 'youtube', 'sign', 'vid-screen', 'richtext'] as const

export type FlatWallFeatureType = (typeof FLAT_WALL_FEATURE_TYPES)[number]

export const isFlatWallFeature = (feature: { type: string }): boolean => (FLAT_WALL_FEATURE_TYPES as readonly string[]).includes(feature.type)
