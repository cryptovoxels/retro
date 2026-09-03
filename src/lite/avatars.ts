import type { Mesh } from '@babylonjs/lite'
import { v7 as uuid } from 'uuid'
import * as messages from '../../common/messages'
import type { LiteControls } from './controls'
import type { Lite } from './index'

const EYE = 0.95 // persona position is the eye, capsule is centred on the body
const HEIGHT = 1.8

// minimal connector: anon, no login, no lerp, no names, no reconnect
export function liteAvatars(lite: Lite, controls: LiteControls) {
  const { L, engine, scene } = lite
  const me = uuid()
  const remote = new Map<string, Mesh>()
  let last = 0

  const url = process.env.NODE_ENV === 'development' ? `ws://${location.hostname}:3780/socket?client_uuid=${me}` : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/mp/socket?client_uuid=${me}`
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'

  const mat = L.createStandardMaterial()
  mat.diffuseColor = [0.6, 0.6, 0.6]

  const move = (a: messages.UpdateAvatarMessage) => {
    if (a.uuid === me) return
    let m = remote.get(a.uuid)
    if (!m) {
      m = L.createCapsule(engine, { height: HEIGHT, radius: 0.3 })
      m.material = mat
      L.addToScene(scene, m)
      remote.set(a.uuid, m)
    }
    m.position.set(a.position[0], a.position[1] - EYE, a.position[2])
  }

  ws.addEventListener('message', (e) => {
    const r = messages.decode(e.data)
    if (r.type !== 'success') return
    const msg = r.message
    switch (msg.type) {
      case messages.MessageType.join:
      case messages.MessageType.worldState:
        msg.avatars?.forEach(move)
        break
      case messages.MessageType.updateAvatar:
        move(msg)
        break
      case messages.MessageType.destroyAvatar: {
        const m = remote.get(msg.uuid)
        if (m) L.removeFromScene(scene, m)
        remote.delete(msg.uuid)
        break
      }
    }
  })
  ws.addEventListener('close', () => console.warn('[lite] multiplayer closed'))

  return {
    tick() {
      const now = performance.now()
      if (ws.readyState !== WebSocket.OPEN || now - last < 200) return
      last = now
      const p = lite.body.position
      ws.send(
        messages.encode({
          type: messages.MessageType.updateAvatar,
          uuid: me,
          animation: 0,
          position: [p.x, p.y, p.z],
          orientation: [0, Math.sin(controls.yaw / 2), 0, Math.cos(controls.yaw / 2)],
        }),
      )
    },
  }
}
