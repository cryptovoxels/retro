import { getBufferFromVoxels, getFieldShape } from '../../../common/voxels/helpers'
import mesher from '../../../common/voxels/mesher'

import { isEqual } from 'lodash'
import type Parcel from '../../../server/parcel'
import { ParcelContentRecord } from '../../../common/messages/parcel'

export type ParcelVersion = { id: string; content: ParcelContentRecord; parcel_id: number }

export class ParcelVersionValidator {
  public readonly featuresBeingRemoved: { type: string; url?: string }[] = []
  private readonly parcel: Parcel

  constructor(parcel: any) {
    this.parcel = parcel
  }

  validate(res: string | ParcelVersion, shouldKeepOutsideParcel = false): ParcelVersion {
    if (!res) {
      throw new Error('no content in file')
    }
    if (!this.parcel.content) {
      this.parcel.content = {}
    }
    if (!this.parcel.content.voxels) {
      this.parcel.content.voxels = ''
    }
    const newVersion: Partial<ParcelVersion> = typeof res === 'string' ? JSON.parse(res) : res
    const currentVersion = Object.assign({}, this.parcel)

    if (!newVersion.id) {
      throw new Error('no id in file')
    }

    if (!newVersion.content) {
      newVersion.content = {} as ParcelContentRecord
    }
    if (!currentVersion.content) {
      currentVersion.content = {}
    }
    // remove content.settings from comparisons and content
    if ('settings' in newVersion.content) delete newVersion.content.settings
    delete currentVersion.content.settings

    // No need to check for same parcel id; Spaces have a different ID.
    // if (newVersion.parcel_id != this.parcel.id) {
    //   throw new Error(`parcel ids doesn't match '${newVersion.parcel_id}' is not '${this.parcel.id}'`)
    // }
    if (!newVersion.content.voxels) {
      throw new Error("No Voxels in JSON! If you want to nerf parcel, select the 'Build...' tab")
    }

    if (!currentVersion.content.voxels) {
      currentVersion.content.voxels = ''
    }

    if (typeof newVersion.content.voxels != 'string') {
      throw new Error('bad encoding on voxels')
    }

    if (isEqual(currentVersion.content, newVersion.content)) {
      throw new Error('This version is not different than the current one')
    }

    const meshParcel = {
      fieldShape: getFieldShape(this.parcel),
      voxels: newVersion.content.voxels,
    }

    // test that the voxeldata can be meshed properly
    let meshDataSize = 0
    try {
      const field = getBufferFromVoxels(meshParcel)
      const mesh = mesher(getFieldShape(this.parcel), field!)
      Object.entries(mesh).forEach(([, v]) => (meshDataSize += v.length || 0))
    } catch (err) {
      throw new Error(`Voxel data isn't parsable: ${err}`)
    }

    // since even the "floor" has mesh voxels, there should be some voxel data
    if (meshDataSize == 0) {
      throw new Error('mesher returned zero mesh data, which is suspicious')
    }

    // this is the feature bounds, which is a softer limit than the parcel bounds
    const bounds = this.featureBounds(this.parcel)
    const size = [bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2]]
    const parcelCentre = [this.parcel.x1 + size[0] / 2, this.parcel.y1 + size[1] / 2, this.parcel.z1 + size[2] / 2]
    // dont @ me, it's how parcel construct sets this.transform.position.y
    parcelCentre[1] = this.parcel.y1

    // if no features in the JSON, just send the version (with no features)
    if (!newVersion.content.features) {
      return newVersion as ParcelVersion
    }
    for (let i = newVersion.content.features.length - 1; i >= 0; i--) {
      const f = newVersion.content.features[i]
      // parcels world position
      const wPos = (f.position as number[]).map((i: number, idx: number) => {
        return parcelCentre[idx] + i
      })

      const fDesc = typeof f.description === 'string' ? JSON.parse(f.description) : f.description
      // remove features if outside the bounds of decency
      if (!this.inside(wPos) && !shouldKeepOutsideParcel) {
        this.featuresBeingRemoved.push({ type: f.type, url: fDesc?.url })
        newVersion.content.features.splice(i, 1)
      }
    }
    return newVersion as ParcelVersion
  }

  inside(wPos: number[]): boolean {
    const bounds = new BABYLON.BoundingBox(new BABYLON.Vector3(this.parcel.x1, this.parcel.y1, this.parcel.z1), new BABYLON.Vector3(this.parcel.x2, this.parcel.y2, this.parcel.z2))

    return bounds.intersectsPoint(BABYLON.Vector3.FromArray(wPos))
  }

  // features live exactly inside the world bounds now, no street fudge
  featureBounds(parcel: Parcel) {
    return [
      [parcel.x1, parcel.y1, parcel.z1],
      [parcel.x2, parcel.y2, parcel.z2],
    ]
  }
}
