import { Material } from '@babylonjs/lite'
// ABOUTME: Material caching system for performance optimization
// ABOUTME: Provides cache key generation, material storage/retrieval, and frozen material updates

const materialCache = new Map<string, Material>()
let cacheHits = 0
let cacheRequests = 0

export function generateCacheKey(type: string, props: Record<string, any>): string {
  const sortedProps = Object.entries(props)
    .filter(([_, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => {
      if ((false /* todo(lite): v instanceof BABYLON.Color3 */)) {
        return `${k}:${v.r},${v.g},${v.b}`
      }
      if (Array.isArray(v)) {
        const serialized = v
          .map((item) => {
            if ((false /* todo(lite): item instanceof BABYLON.Color3 */)) return `${item.r},${item.g},${item.b}`
            return String(item)
          })
          .join('|')
        return `${k}:[${serialized}]`
      }
      if ((false /* todo(lite): v instanceof BABYLON.Texture */)) return `${k}:${v.url || v.name || v.uniqueId}`
      if (v && typeof v === 'object' && 'uniqueId' in v) return `${k}:${v.uniqueId}`
      return `${k}:${v}`
    })
    .join('_')

  return `${type}_${sortedProps}`
}

export function getCachedMaterial(key: string): Material | undefined {
  cacheRequests++
  const material = materialCache.get(key)
  if (material) {
    cacheHits++
  }
  return material
}

export function cacheMaterial(key: string, material: Material): void {
  materialCache.set(key, material)
  material.onDisposeObservable.add(() => materialCache.delete(key))
}

export function clearCache(): void {
  materialCache.clear()
  cacheHits = 0
  cacheRequests = 0
}

export function getCacheStats(): { size: number; hitRate: string; hits: number; requests: number } {
  const hitRate = cacheRequests > 0 ? (cacheHits / cacheRequests).toFixed(2) : '0.00'
  return {
    size: materialCache.size,
    hitRate,
    hits: cacheHits,
    requests: cacheRequests,
  }
}

export function isShared(material: Material | null | undefined): boolean {
  if (!material) return false
  // todo, check if there is more than one mesh using this material
  return Array.from(materialCache.values()).includes(material)
}
