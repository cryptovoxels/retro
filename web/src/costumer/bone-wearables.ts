import type { CollectiblesData } from '../../../common/helpers/collections-helpers'

/** Wearables to offer for a skeleton bone (mixamorig short name, e.g. LeftHand). */
export function wearablesForBone(bone: string, wearables: CollectiblesData[]): CollectiblesData[] {
  const b = bone.toLowerCase()
  return wearables.filter((w) => {
    const d = (w.default_bone || '').trim().toLowerCase()
    const cat = (w.category || '').toLowerCase()
    if (d === b) return true
    if (d && b.startsWith(d)) return true
    if (d && d.startsWith(b)) return true
    if (!d && (cat === 'hands' || cat === 'arms')) {
      if (b.startsWith('left') || b.startsWith('right')) return true
    }
    if (!d && cat === 'headwear' && (b === 'head' || b.startsWith('head'))) return true
    if (!d && cat === 'facewear' && (b === 'head' || b.startsWith('head'))) return true
    if (!d && cat === 'feet' && b.includes('foot')) return true
    return false
  })
}
