import { throttle } from 'lodash'
import { v7 as uuid } from 'uuid'
import { Patch, PatchMessage } from '../../common/messages/grid'
import { getVoxelsFromBuffer } from '../../common/voxels/helpers'
import log from '../lib/logger'
import { AbstractParcel } from '../parcel'
import { GridShardMessage } from './GridShardMessage'

const SYNC_WAIT = 1000

export class PatchSet {
  pendingPatchMessages: Array<PatchMessage & { id: string }>
  sync: Function

  constructor(
    private readonly loadParcel: (id: number) => Promise<AbstractParcel | null>,
    private publishShardMessage: (message: GridShardMessage) => void,
  ) {
    this.pendingPatchMessages = []
    this.sync = throttle(() => this._sync(), SYNC_WAIT, { leading: false, trailing: true })
  }

  add(parcelId: number, patch: Patch): void {
    this.pendingPatchMessages.push({
      type: 'patch',
      id: uuid(),
      parcelId,
      patch,
    })
    this.sync()
  }

  private _sync() {
    const pendingPatchMessages = this.pendingPatchMessages.slice()
    const parcelIds = Array.from(new Set(pendingPatchMessages.map((p) => p.parcelId)))

    parcelIds.forEach(async (id) => {
      log.debug(`loading ${id}`)

      const parcel = await this.loadParcel(id)

      if (!parcel) {
        log.error(`PatchSet: Parcel ${id} does not exist`)
        return
      }
      let shouldUpdateParcelScript = false
      try {
        const patchMessagesToProcess = pendingPatchMessages.filter((p) => p.parcelId === id)

        patchMessagesToProcess.forEach((patchMessage) => {
          const { patch } = patchMessage

          if (!parcel.content) {
            parcel.content = {}
          }

          if (!Array.isArray(parcel.content.features)) {
            parcel.content.features = []
          }

          // Lightmap-only patch: just persist the URL, don't invalidate it
          if ('lightmap_url' in patch && typeof patch.lightmap_url === 'string') {
            parcel.lightmap_url = patch.lightmap_url
            return
          }

          if ('features' in patch && typeof patch.features === 'object' && patch.features) {
            Object.entries(patch.features).forEach(([uuid, value]) => {
              const feature = parcel.getFeatureByUuid(uuid)

              if (value && 'uuid' in value) {
                value.uuid = uuid // just to make sure nothing sneaky going on
              }

              // Groups are currently sending the children to the database and that's bad.
              value && delete value.children

              if (feature) {
                if (!value) {
                  // clear out all instances of this ID (just in case we're dealing with item duplication)
                  parcel.content.features = parcel.content.features.filter((f: any) => f?.uuid !== uuid)
                } else {
                  // update the feature in place using the patch
                  Object.assign(feature, value)
                }
              } else if (value && value.uuid) {
                parcel.content.features.push(value)
              }
            })
          }

          if ('voxels' in patch && typeof patch.voxels === 'object') {
            const voxels = patch.voxels as { positions: [number, number, number][]; value: number }
            const positions = voxels.positions
            const value = voxels.value

            const f = parcel.loadField()!

            for (const v of positions) {
              f.set(...v, value)
            }

            parcel.voxels = getVoxelsFromBuffer(f.data.buffer)
          }

          if ('voxels' in patch && typeof patch.voxels === 'string') {
            parcel.voxels = patch.voxels
          }

          if ('palette' in patch && Array.isArray(patch.palette)) {
            parcel.content.palette = patch.palette
          }

          if ('tileset' in patch) {
            parcel.content.tileset = patch.tileset
          }

          if ('brightness' in patch && typeof patch.brightness === 'number') {
            parcel.content.brightness = patch.brightness
          }

          // Content changed -- old lightmap is stale
          parcel.lightmap_url = null

          // If shouldUpdateParcelScript is already true, no need to re-update it.
          shouldUpdateParcelScript = shouldUpdateParcelScript ? shouldUpdateParcelScript : hasScript(patch)
        })

        log.debug(`saving ${id}`)
        await parcel.save()

        if (shouldUpdateParcelScript) {
          // We need to wait for the parcel to be saved, so the things that respond to this event can reload the latest script-affecting features
          this.publishShardMessage({ type: 'scriptUpdate', payload: { parcelId: id } })
        }

        // Remove these patches from the list
        const processedPatchMessageIds = new Set(pendingPatchMessages.map((m) => m.id))
        this.pendingPatchMessages = this.pendingPatchMessages.filter((m) => processedPatchMessageIds.has(m.id) === false)
      } catch (e) {
        log.error('Bad error updating parcel', e)
      }
    })
  }
}

function hasScript(patch: { features?: any }) {
  if (!patch.features) {
    return false
  }
  const features = Object.values(patch.features) as any[]
  const scripted = features?.find((f) => f?.script)
  return !!scripted
}
