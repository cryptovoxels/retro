import { GridShardMessage } from './GridShardMessage'

/**
 * A pub/sub interface for sharing messages between each instance of the grid. The cluster will not discriminate
 * messages by which instance they were received from, so publishers must expect to receive their own messages.
 */
export type GridClusterMessageBroker = {
  publish(message: GridClusterMessage): void
  subscribe(listener: GridClusterListener): void
}

export type GridClusterListener = (message: GridClusterMessage) => void

export type GridClusterMessage = GridShardMessage & { payload: { spaceId?: string } }

export namespace GridClusterMessage {
  export type PatchCreate = Extract<GridClusterMessage, { type: 'patchCreate' }>

  export type PatchStateCreate = Extract<GridClusterMessage, { type: 'patchStateCreate' }>

  export type MetaUpdate = Extract<GridClusterMessage, { type: 'metaUpdate' }>

  export type ScriptUpdate = Extract<GridClusterMessage, { type: 'scriptUpdate' }>

  export type LightmapUpdate = Extract<GridClusterMessage, { type: 'lightmapUpdate' }>

  export const withSpaceId = (message: GridClusterMessage, spaceId: string | undefined): GridClusterMessage => {
    return {
      ...message,
      payload: {
        ...message.payload,
        spaceId,
      },
    } as GridClusterMessage
  }
}
