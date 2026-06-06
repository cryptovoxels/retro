import { performance } from 'perf_hooks'
import { authFeature, authParcelByNFT } from '../auth-parcel'
import { ParcelAuthRef } from '../parcel'
import log from '../lib/logger'
import { sendNerfLogToSlack } from '../jobs/send-slack-log'
import {
  DeleteFeatureMessage,
  GridClientMessage,
  GridMessage,
  LightmapActionMessage,
  ParcelAuthMessage,
  ParcelHashMessage,
  ParcelMetaMessage,
  ParcelScriptMessage,
  PatchErrorMessage,
  PatchMessage,
  PatchStateMessage,
  SubscriptionMessage,
  SuspendedMessage,
} from '../../common/messages/grid'
import { GridClient } from './GridClient'
import { GridShardMessage } from './GridShardMessage'
import { ParcelAuthResult } from '../../common/messages/parcel'
import { VoxelsUser } from '../user'

type StatefulGridClient = GridClient & {
  parcelSubscriptions: Set<number>
  lastSeen: number
}

export default class GridShard {
  private clientsById: Map<string, StatefulGridClient> = new Map<string, StatefulGridClient>()
  private clientsByWallet: Map<string, Set<string>> = new Map<string, Set<string>>()
  private clientsByParcelId: Map<number, Set<string>> = new Map<number, Set<string>>()

  public constructor(
    private getParcel: (parcelId: number) => Promise<ParcelAuthRef | null>,
    private getFeature: (parcel: ParcelAuthRef, featureId: string) => Promise<unknown | null>,
    private getState: (parcelId: number) => Promise<Record<string, unknown> | null>,
    private publishShardMessage: (message: GridShardMessage) => Promise<void>,
    private startLightmapBake: (parcelId: number) => Promise<void>,
    private cancelLightmapBake: (parcelId: number) => Promise<void>,
    private authParcel: (parcel: ParcelAuthRef, user: VoxelsUser | null) => Promise<ParcelAuthResult>,
  ) {}

  public get clients(): GridClient[] {
    return Array.from(this.clientsById.values())
  }

  public handleShardMessage(message: GridShardMessage): void {
    switch (message.type) {
      case 'patchCreate':
        this.broadcastGridMessage(message.payload.parcelId, message.payload.sender, {
          type: 'patch',
          parcelId: message.payload.parcelId,
          patch: message.payload.patch,
        })
        break
      case 'patchStateCreate':
        this.broadcastGridMessage(message.payload.parcelId, message.payload.sender, {
          type: 'patch-state',
          parcelId: message.payload.parcelId,
          patch: message.payload.patch,
        })
        break
      case 'lightmapUpdate':
        this.broadcastGridMessage(message.payload.parcelId, null, {
          type: 'lightmap-status',
          parcelId: message.payload.parcelId,
          lightmap_url: message.payload.lightmap_url,
          hash: message.payload.hash,
        })
        break
      case 'hashUpdate':
        this.broadcastParcelHash(message.payload.parcelId, message.payload.hash)
        break
      case 'metaUpdate':
        this.broadcastParcelMeta(message.payload.parcelId)
        break
      case 'scriptUpdate':
        this.broadcastParcelScriptUpdate(message.payload.parcelId)
        break
      default: {
        const n: never = message
        log.warn(`unhandled grid cluster message type: ${JSON.stringify(n)}`)
      }
    }
  }

  public handleClientMessage(client: GridClient, message: GridClientMessage): void {
    const statefulClient = this.clientsById.get(client.id)
    if (!statefulClient) {
      log.error('received message from unregistered client')
      return
    }
    statefulClient.lastSeen = performance.now()
    switch (message.type) {
      case 'subscription':
        this.handleSubscription(statefulClient, message)
        break
      case 'patch':
        this.handlePatch(statefulClient, message)
        break
      case 'patch-state':
        this.handlePatchState(statefulClient, message)
        break
      case 'delete-feature':
        this.handleDeleteFeature(statefulClient, message)
        break
      case 'ping':
        statefulClient.send({ type: 'pong' })
        break
      case 'lightmap-action':
        // this.handleLightmap(statefulClient, message)
        break
      default: {
        const n: never = message
        log.error('unhandled message type: ' + JSON.stringify(n))
      }
    }
  }

  // public async updateAndSendLightmapStatus(parcel: AbstractParcel, status: LightmapStatus) {
  //   parcel.lightmap_url = status
  //   await parcel.save()

  //   // Fire-and-forget
  //   this.sendLightmapStatus(parcel.id, parcel?.hash, parcel?.lightmap_url)
  // }

  public addClient(client: GridClient): void {
    const statefulClient: StatefulGridClient = {
      ...client,
      parcelSubscriptions: new Set(),
      lastSeen: performance.now(),
    }

    this.clientsById.set(statefulClient.id, statefulClient)

    if (statefulClient.user?.wallet) {
      const wallet = statefulClient.user.wallet.toLowerCase()
      const previousClientsForWallet = this.clientsByWallet.get(wallet) || new Set<string>()
      const clientsForWallet = previousClientsForWallet.add(statefulClient.id)
      this.clientsByWallet.set(wallet, clientsForWallet)
    }

    if (statefulClient.user?.suspended) {
      this.sendSuspended(statefulClient)
    }
  }

  public removeClient(client: GridClient): void {
    const statefulClient = this.clientsById.get(client.id)
    if (!statefulClient) {
      return
    }

    const wallet = statefulClient.user?.wallet?.toLowerCase()

    this.clientsById.delete(statefulClient.id)

    for (const parcelId of Array.from(statefulClient.parcelSubscriptions)) {
      this.clientsByParcelId.get(parcelId)!.delete(statefulClient.id)
    }

    if (wallet) {
      this.clientsByWallet.get(wallet)!.delete(statefulClient.id)
    }
  }

  public removeClientsByWallet(wallet: string) {
    const clientsForWallet = this.clientsByWallet.get(wallet)
    if (clientsForWallet) {
      Array.from(clientsForWallet.values()).forEach((id) => this.clientsById.get(id)!.close())
    }
  }

  public removeInactiveClients(maxMilliSeconds: number) {
    Array.from(this.clientsById.values()).forEach((client) => {
      if (performance.now() - client.lastSeen > maxMilliSeconds) {
        client.close()
      }
    })
  }

  private sendSuspended(client: StatefulGridClient) {
    const msg: SuspendedMessage = {
      type: 'suspended',
      reason: client.user!.suspended!.reason,
      expiresAt: client.user!.suspended!.expires_at as any,
    }
    client.send(msg)
  }

  private sendPatchError(client: StatefulGridClient, originalPatch: PatchMessage, error: string, rollbackHash?: string) {
    const msg: PatchErrorMessage = {
      type: 'patch-error',
      patch: originalPatch.patch,
      parcelId: originalPatch.parcelId,
      rollbackHash,
      error,
    }
    client.send(msg)
  }

  private forEachClientInParcel(callingFuncName: string, parcelId: number, callback: (client: StatefulGridClient) => void) {
    const clientsForParcel = this.clientsByParcelId.get(parcelId)
    if (clientsForParcel) {
      for (const clientId of Array.from(clientsForParcel)) {
        const client = this.clientsById.get(clientId)
        if (client) {
          callback(client)
        } else {
          //@TODO: investigate why client is undefined
          // https://app.shortcut.com/cryptovoxels/story/2888/catch-client-null-in-gridshard
          log.error(`GridShard.${callingFuncName}(parcelId=${parcelId}): ERROR: client ID '${clientId}' in clientsByParcelId.get(${parcelId}) is missing from clientsById!`)
        }
      }
    }
  }

  private async broadcastParcelHash(parcelId: number, hash: string) {
    const msg: ParcelHashMessage = {
      type: 'parcel-hash',
      parcelId,
      hash,
    }

    this.forEachClientInParcel('broadcastParcelHash', parcelId, (client) => client.send(msg))
  }

  /**
   * Send new Auth to all users in the parcel and new Meta. (useful if parcel owner just set the parcel as Sandbox, or if he changed the collaborators.)
   * @param parcelId
   * @returns
   */
  private async broadcastParcelMeta(parcelId: number) {
    const parcel = await this.getParcel(parcelId)

    if (parcel) {
      this.forEachClientInParcel('broadcastParcelMeta', parcelId, (client) => {
        const msg: ParcelMetaMessage = {
          type: 'parcel-meta',
          parcelId,
          meta: parcel,
        }

        client.send(msg)

        this.sendAuth(parcel, client)
      })
    }
  }

  /**
   * Send a trigger to refresh the Parcel script.
   * @param parcelId
   * @returns
   */
  private async broadcastParcelScriptUpdate(parcelId: number) {
    const msg: ParcelScriptMessage = {
      type: 'parcel-script',
      parcelId,
    }

    this.forEachClientInParcel('broadcastParcelScriptUpdate', parcelId, (client) => client.send(msg))
  }

  private async handleSubscription(client: StatefulGridClient, msg: SubscriptionMessage) {
    if (typeof msg.parcelId != 'number') return

    if (msg.subscribed) {
      const parcel = await this.getParcel(msg.parcelId)

      if (parcel) {
        client.parcelSubscriptions.add(parcel.id)
        const previousSubscribedClientsForParcel = this.clientsByParcelId.get(parcel.id) || new Set<string>()
        const subscribedClientsForParcel = previousSubscribedClientsForParcel.add(client.id)
        this.clientsByParcelId.set(parcel.id, subscribedClientsForParcel)

        const parcelHashMsg: ParcelHashMessage = {
          type: 'parcel-hash',
          parcelId: parcel.id,
          hash: parcel.hash,

          // hack: include the lightmap_status until we can get a better cache busting mechanism (I HATE IT)
          // see https://github.com/cryptovoxels/cryptovoxels/issues/584
          lightmap_url: parcel.lightmap_url,
        }
        // reply with the hash of the subscribed parcel so that the client knows if reload is needed
        client.send(parcelHashMsg)

        this.sendAuth(parcel, client)

        // TODO: Why this as well as hash?
        sendParcelState(client, parcel.id, (await this.getState(parcel.id)) || {})
      }
    } else {
      client.parcelSubscriptions.delete(msg.parcelId)
      this.clientsByParcelId.get(msg.parcelId)?.delete(client.id)
    }
  }

  private async sendAuth(parcel: ParcelAuthRef, client: StatefulGridClient) {
    const auth = await this.authParcel(parcel, client.user)

    // Send a separate message including both the auth and NFT auth
    const parcelAuthMsg: ParcelAuthMessage = {
      type: 'parcel-auth',
      parcelId: parcel.id,

      // include socket auth for canEdit cache busting
      auth,

      // include boolean nftAuth which checks whether the user has parcel's required NFT or not.
      // Only check NFT ownership if AUTH is Sandbox OR is false
      nftAuth: auth && auth !== 'Sandbox' ? true : await authParcelByNFT(parcel, client.user),
    }
    // reply with the hash of the subscribed parcel so that the client knows if reload is needed
    client.send(parcelAuthMsg)
  }

  private async handlePatch(client: StatefulGridClient, msg: PatchMessage) {
    if (typeof msg.parcelId != 'number') return
    const parcel = await this.getParcel(msg.parcelId)
    if (!parcel) {
      this.sendPatchError(client, msg, 'Invalid parcel')
      log.warn(`user tried to patch an invalid parcel "${msg.parcelId}"`)
      return
    }
    const authResult = await this.authParcel(parcel, client.user)

    // We do not have authorization to edit the parcel, but maybe one of the features of the patch is outside the parcel and was removed by
    // a neighbor or a moderator.
    // In which case we check relative Position, and if the feature is outside we allow the edit.
    // This is to allow people removing features violating their parcel's space
    if (!authResult) {
      this.sendPatchError(client, msg, 'Incorrect permissions', parcel.hash)
      log.warn('user tried to patch a parcel without correct permissions')
      return
    }

    // this allows anon users to place blocks.
    // These anonymous users are not allowed to place features.
    if (!client.user && 'features' in msg.patch) {
      this.sendPatchError(client, msg, 'Incorrect permissions', parcel.hash)
      log.warn('user tried to patch a parcel without correct permissions')
      return
    }

    const hadLightmap = !!parcel.lightmap_url

    this.publishShardMessage({
      type: 'patchCreate',
      payload: {
        parcelId: msg.parcelId,
        patch: msg.patch,
        sender: client.id,
      },
    })

    if (hadLightmap) {
      // Changes to a parcel will invalidate the lightmap, however the user won't know this has happened unless they refresh.
      // This sends the message out immediately so that all clients (including builder) see the lightmap change immediately.
      this.sendLightmapStatusUpdate(msg.parcelId, parcel.hash, parcel.lightmap_url)
    }
  }

  private async handleDeleteFeature(client: StatefulGridClient, msg: DeleteFeatureMessage) {
    if (typeof msg.currentParcelId !== 'number') return
    if (typeof msg.parcelId !== 'number') return
    // make sure they are allowed to delete the feature
    // check to make sure the feature is inside their parcel
    const authFeatureResult = await authFeature(msg.parcelId, msg.featureUuid, msg.currentParcelId, client.user)
    if (!authFeatureResult) return

    const patch: PatchMessage = {
      type: 'patch',
      parcelId: msg.parcelId,
      patch: { features: { [msg.featureUuid]: null } },
    }

    this.publishShardMessage({
      type: 'patchCreate',
      payload: {
        parcelId: patch.parcelId,
        patch: patch.patch,
        sender: client.id,
      },
    })

    sendNerfLogToSlack(authFeatureResult, client.user?.wallet || '<no-wallet>')
  }

  private async handlePatchState(client: StatefulGridClient, msg: PatchStateMessage) {
    if (typeof msg.parcelId != 'number') return

    const parcel = await this.getParcel(msg.parcelId)
    if (!parcel || !msg.patch) return

    const broadcastResult: Record<string, unknown> = {}
    for (const [uuid, value] of Object.entries(msg.patch)) {
      if (uuid === '__showbox_live') {
        broadcastResult[uuid] = value
        continue
      }
      const feature = await this.getFeature(parcel, uuid)
      if (feature) {
        broadcastResult[uuid] = value
      }
    }

    if (Object.keys(broadcastResult).length) {
      this.publishShardMessage({
        type: 'patchStateCreate',
        payload: {
          parcelId: msg.parcelId,
          patch: broadcastResult,
          sender: client.id,
        },
      })
    }
  }

  private async handleLightmap(client: StatefulGridClient, msg: LightmapActionMessage) {
    const parcel = await this.getParcel(msg.parcelId)
    if (!parcel) {
      // should probably tell the client something went wrong here.
      return
    }
    const authResult = await this.authParcel(parcel, client.user)

    if (authResult) {
      await (msg.requestBake ? this.startLightmapBake(msg.parcelId) : this.cancelLightmapBake(msg.parcelId))
      const newParcel = await this.getParcel(msg.parcelId)
      if (!newParcel) {
        return
      }
      this.sendLightmapStatusUpdate(msg.parcelId, newParcel.hash, newParcel.lightmap_url)
    }
  }

  private sendLightmapStatusUpdate(parcelId: number, hash: string, lightmap_url: string | null) {
    return this.publishShardMessage({
      type: 'lightmapUpdate',
      payload: {
        parcelId,
        hash,
        lightmap_url,
      },
    })
  }

  private broadcastGridMessage(parcelId: number, sender: string | null, msg: GridMessage) {
    this.forEachClientInParcel('broadcastGridMessage', parcelId, (client) => {
      if (client.id !== sender) {
        client.send(msg)
      }
    })
  }
}

async function sendParcelState(client: StatefulGridClient, parcelId: number, state: Record<string, unknown>) {
  // send the entire state as a patch
  if (Object.keys(state).length) {
    client.send({
      type: 'patch-state',
      parcelId,
      patch: state,
    })
  }
}
