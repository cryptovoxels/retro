import { FeatureRecord } from '../../common/messages/feature'
import type { SimpleSpaceRecord, SpaceRecord } from '../../common/messages/space'
import { AvatarRef, avatarName } from '../../common/messages/avatar-ref'

export default class SpaceHelper {
  id: string
  slug: string | null = null
  name: string | null = null
  height: number
  owner: AvatarRef
  area: number | null = null

  width: number | null = null
  depth: number | null = null
  content: Partial<{ voxels: string; features: FeatureRecord[] }> | null = null

  constructor(obj: SpaceRecord | SimpleSpaceRecord) {
    this.id = obj.id
    this.name = obj.name
    this.height = obj.height
    this.owner = obj.owner
    if ('content' in obj) {
      this.content = obj.content
      this.slug = obj.slug
      this.area = obj.area
      this.width = obj.width
      this.depth = obj.depth
    }
  }

  get center(): [number, number] | null {
    if (!this.width || !this.depth) {
      return null
    }
    return [this.width / 2, this.depth / 2]
  }

  get latLng() {
    const center = this.center
    if (!center) return null
    return { lat: center[1], lng: center[0] }
  }

  get visitUrl() {
    return `/spaces/${this.id}/play`
  }

  get ownerName() {
    return avatarName(this.owner)
  }
}
