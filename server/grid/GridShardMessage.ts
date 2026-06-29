import { LightmapStatus } from '../../common/messages/parcel'

export type GridShardMessage = GridShardMessage.PatchCreate | GridShardMessage.PatchStateCreate | GridShardMessage.MetaUpdate | GridShardMessage.ScriptUpdate | GridShardMessage.LightmapUpdate

export namespace GridShardMessage {
  export type PatchCreate = {
    type: 'patchCreate'
    payload: {
      sender: string
      parcelId: number
      patch: {
        [x: string]: unknown
      }
    }
  }

  export type PatchStateCreate = {
    type: 'patchStateCreate'
    payload: {
      sender: string
      parcelId: number
      patch: {
        [x: string]: unknown
      }
    }
  }

  export type MetaUpdate = {
    type: 'metaUpdate'
    payload: {
      parcelId: number
    }
  }

  export type ScriptUpdate = {
    type: 'scriptUpdate'
    payload: {
      parcelId: number
    }
  }

  export type LightmapUpdate = {
    type: 'lightmapUpdate'
    payload: {
      parcelId: number
      lightmap_url: string | null
    }
  }
}
