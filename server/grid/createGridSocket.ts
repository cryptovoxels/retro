import http from 'http'
import { jwtVerify } from 'jose'
import log from '../lib/logger'
import { ParcelEventEmitter } from '../parcel'
import { GridClusterMessageBroker } from './GridClusterMessageBroker'
import GridSocket from './GridSocket'
import PgGridClusterMessageBroker from './impl/PgGridClusterMessageBroker'

const verifyToken =
  (jwtSecretOrKey: string) =>
  (token: string): Promise<{ wallet: string; guest_pass?: string; parcel_id?: number } | null> =>
    jwtVerify(token, new TextEncoder().encode(jwtSecretOrKey), { algorithms: ['HS256'] })
      .then(({ payload }) => payload as any)
      // guest co-host jwts carry the pass + parcel binding - the shard uses it to auth showbox live patches
      .then((decoded) => ({ wallet: decoded.wallet, guest_pass: decoded.guest_pass, parcel_id: decoded.parcel_id }) as { wallet: string; guest_pass?: string; parcel_id?: number })
      .catch((err) => {
        log.error(`grid-socket jwt verification error: ${err.toString()}`)
        return null
      })

const createGridCluster = (): GridClusterMessageBroker => {
  return process.env.NODE_ENV === 'test'
    ? {
        publish: () => {},
        subscribe: () => {},
      }
    : new PgGridClusterMessageBroker()
}

const createGridSocket = (server: http.Server, jwtSecretOrKey: string, parcelEventEmitter: ParcelEventEmitter): GridSocket => {
  const gridCluster = createGridCluster()

  parcelEventEmitter.on('metaUpdate', (parcelId) => gridCluster.publish({ type: 'metaUpdate', payload: { parcelId } })).on('scriptUpdate', (parcelId) => gridCluster.publish({ type: 'scriptUpdate', payload: { parcelId } }))

  return new GridSocket(server, '/grid/socket', verifyToken(jwtSecretOrKey), gridCluster)
}

export default createGridSocket
