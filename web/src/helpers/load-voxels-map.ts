import type { MapMarker, ParcelData, VoxelsMap, VoxelsMapOpts } from '../../../src/voxels-map'

export type { MapMarker, ParcelData, VoxelsMap, VoxelsMapOpts }

// load the map class only in the browser
export async function loadVoxelsMap() {
  return import('../../../src/voxels-map')
}
