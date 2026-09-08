import Grid from './grid'
import { createWorldScene } from './init/world-scene'
import type { ParcelRecord } from '../common/messages/parcel'
import type Parcel from './parcel'

export class NullGrid extends Grid {
  constructor(scene: BABYLON.Scene) {
    super(scene)
  }

  get seeksConnection() {
    return false
  }

  get hasField() {
    return true
  }

  protected addInterval(_func: () => void, _intervalMs: number) {}

  spawnPreview(record: ParcelRecord): Parcel | undefined {
    return super.spawnPreview(record)
  }

  async preparePreview() {
    await createWorldScene(window.scene)
  }
}
