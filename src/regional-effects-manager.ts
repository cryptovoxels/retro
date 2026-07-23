// compares camera position to known cuboid regions
// if match: dispatches events notifiying of region + regional effects (e.g. fog, skybox, etc)

import { isBatterySaver } from '../common/helpers/detector'
import PlayerCamera from './controls/utils/player-camera'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'

type Region = {
  name: string
  bounds: BABYLON.BoundingBox
  border: number
  effect: RegionEffect
  value: string
}

// todo increase accuracy (currently just eyeballed the bounding boxes)
const chronos_winter_bounds = new BABYLON.BoundingBox(new BABYLON.Vector3(3504.988540883255, -10, -2055), new BABYLON.Vector3(3766, 1000, -1810.590852730386))
const chronos_winter_region: Region = {
  name: 'chronos_winter',
  bounds: chronos_winter_bounds,
  effect: 'color-grading',
  border: 5,
  value: '/luts/winter.3dl',
}
const chronos_winter_sky_region: Region = {
  name: 'chronos_winter_sky',
  bounds: chronos_winter_bounds,
  effect: 'skybox',
  border: 5,
  value: 'winter/skybox',
}

const chronos_summer_bounds = new BABYLON.BoundingBox(new BABYLON.Vector3(3232.5902946057436, -10, -1796.7246437808456), new BABYLON.Vector3(3492.850295786301, 1000, -1532.8702340486))
const chronos_summer_region: Region = {
  name: 'chronos_summer',
  bounds: chronos_summer_bounds,
  effect: 'color-grading',
  border: 5,
  value: '/luts/summer.3dl',
}
const chronos_summer_sky_region: Region = {
  name: 'chronos_summer_sky',
  bounds: chronos_summer_bounds,
  effect: 'skybox',
  border: 5,
  value: 'summer/skybox',
}

const chronos_autumn_bounds = new BABYLON.BoundingBox(new BABYLON.Vector3(3508.2371276456156, -10, -1797.7762251232175), new BABYLON.Vector3(3767, 1000, -1558))
const chronos_autumn_region: Region = {
  name: 'chronos_autumn',
  bounds: chronos_autumn_bounds,
  effect: 'color-grading',
  border: 5,
  value: '/luts/autumn.3dl',
}
const chronos_autumn_sky_region: Region = {
  name: 'chronos_autumn_sky',
  bounds: chronos_autumn_bounds,
  effect: 'skybox',
  border: 5,
  value: 'autumn/skybox',
}

const chronos_spring_bounds = new BABYLON.BoundingBox(new BABYLON.Vector3(3238, -10, -2044), new BABYLON.Vector3(3492.3313942503055, 1000, -1807.6022205425343))
const chronos_spring_region: Region = {
  name: 'chronos_spring',
  bounds: chronos_spring_bounds,
  effect: 'color-grading',
  border: 5,
  value: '/luts/spring.3dl',
}
const chronos_spring_sky_region: Region = {
  name: 'chronos_spring_sky',
  bounds: chronos_spring_bounds,
  effect: 'skybox',
  border: 5,
  value: 'spring/skybox',
}

const testIslandBounds = new BABYLON.BoundingBox(new BABYLON.Vector3(4136, -10, -64), new BABYLON.Vector3(4264, 1000, 64))
const test_island_region: Region = {
  name: 'test-island-colors',
  bounds: testIslandBounds,
  effect: 'color-grading',
  border: 30,
  value: '/luts/latesunset.3dl',
}
const test_island_sky_region: Region = {
  name: 'test-island-skybox',
  bounds: testIslandBounds,
  effect: 'skybox',
  border: 30,
  value: 'TropicalSunnyDay',
}

// todo what about multiple effects in a region: merge? or duplicates?
// todo retrieve from server
// array should be fine with only a few regions, but if we have many we should use some form of spatial partitioning
const RegionMap: Region[] = [
  test_island_region,
  test_island_sky_region,
  chronos_winter_region,
  chronos_summer_region,
  chronos_autumn_region,
  chronos_spring_region,
  chronos_winter_sky_region,
  chronos_summer_sky_region,
  chronos_autumn_sky_region,
  chronos_spring_sky_region,
]

// Only for 2D, ignores height
function distanceOfPointFromBoxEdge(rect: BABYLON.BoundingBox, p: BABYLON.Vector3) {
  const dx = Math.max(rect.minimum.x - p.x, 0, p.x - rect.maximum.x)
  const dy = Math.max(rect.minimum.z - p.z, 0, p.z - rect.maximum.z)
  return Math.sqrt(dx * dx + dy * dy)
}

function getCameraDistanceFromBounds(bounds: BABYLON.BoundingBox, camera: PlayerCamera) {
  return distanceOfPointFromBoxEdge(bounds, camera.position)
}

// fast floor function
function toTwoDecimalPlaces(num: number) {
  return ~~(num * 100) / 100
}

// a quick sanity check function to make sure the regions are valid and do not overlap
function validateRegions(regions: Region[]) {
  for (const region of regions) {
    if (region.border < 0) throw new Error(`Region ${region.name} has invalid border ${region.border}`)
    if (region.bounds.minimum.x > region.bounds.maximum.x) throw new Error(`Region ${region.name} has invalid bounds ${region.bounds}`)
    if (region.bounds.minimum.z > region.bounds.maximum.z) throw new Error(`Region ${region.name} has invalid bounds ${region.bounds}`)
    if (!region.effect) throw new Error(`Region ${region.name} has no effect!`)

    // test for overlap
    if (
      regions.some((r) => {
        if (r.name === region.name) return false // its me
        if (r.effect !== region.effect) return false // we are different

        // add the cumilative borders to the checked bounds, to be sure of no overlapping tranistion zones
        const borderVector = new BABYLON.Vector3(region.border + r.border, 0, region.border + r.border)
        return region.bounds.intersectsMinMax(r.bounds.minimum.subtract(borderVector), r.bounds.maximum.add(borderVector))
      })
    )
      throw new Error(`Region ${region.name} is overlapping with another region of same type!`) // oops
  }
}

export type RegionEffect = 'fog' | 'skybox' | 'color-grading' | 'bloom' | 'night' // etc
export type RegionEffectState = 'entered' | 'exited'
export type RegionEventName = `${RegionEffect}-${RegionEffectState}`
export type RegionEvent = {
  /** 0-1 where 0 is at the edge of the border region and 1 is inside the region */
  strength: number
  /** the effect value, e.g. Lut uri, skybox name etc */
  value: string
}
export default class RegionalManager extends TypedEventTarget<Record<RegionEventName, RegionEvent>> {
  private readonly checkFunction: () => void
  private activeRegions: Map<string, number> = new Map()

  constructor(private scene: BABYLON.Scene) {
    super()
    // before we do anything check that we have not messed up the regions
    validateRegions(RegionMap)

    // assign our check function with the correct this, and hold a ref for easy removal
    this.checkFunction = () => {
      if (this.scene.getFrameId() % 3 === 0) return // only check every other, other frame

      if (!this.camera) {
        console.warn('no camera')
        return
      }

      for (const region of RegionMap) {
        const distance = getCameraDistanceFromBounds(region.bounds, this.camera)
        if (distance <= region.border) {
          // float to 2 decimal places to avoid spamming events for inconsequential changes
          const strength = toTwoDecimalPlaces(1 - distance / region.border)
          if (this.activeRegions.get(region.name) === strength) continue // no change

          this.dispatchEvent(createEvent(`${region.effect}-entered`, { strength, value: region.value }))
          this.activeRegions.set(region.name, strength)
        } else if (this.activeRegions.has(region.name)) {
          this.dispatchEvent(createEvent(`${region.effect}-exited`, { strength: 0, value: region.value }))
          this.activeRegions.delete(region.name)
        }
      }
    }

    if (!isBatterySaver()) {
      this.scene.onAfterRenderObservable.add(this.checkFunction)
    }
  }

  private get camera() {
    return this.scene.cameras[0] as PlayerCamera | null
  }

  // for debug purposes
  public calculateRegionStrength(regionName: string) {
    const region = RegionMap.find((r) => r.name === regionName)
    if (!region) {
      console.warn(`region ${regionName} not found`)
      return 0
    }
    if (!this.camera) {
      console.warn('no camera')
      return 0
    }
    const distance = getCameraDistanceFromBounds(region.bounds, this.camera)
    if (distance <= region.border) {
      return 1 - distance / region.border
    }
    return 0
  }

  dispose() {
    this.scene.onAfterRenderObservable.removeCallback(this.checkFunction)
  }
}
