// max times to reconnect
const MAX_RECONNECT_RETRIES = 10
// max time between reconnects (capped exponential backoff, before jitter)
const MAX_RECONNECT_TIME = 60000
// the amount of jitter (randomness) in the reconnection to avoid clients reconnection at the same time
// the higher this value the more spread out the clients should be
const RECONNECT_JITTER_FRACTION = 1 / 3

// The duration of time we keep track of connection failures for. More connection failures => greater reconnect delay.
const RETRY_HISTORY_TTL = MAX_RECONNECT_TIME * MAX_RECONNECT_RETRIES

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))

export type ConnectionState =
  | {
      status: 'disconnected'
      lastCloseCode: number | null
    }
  | { status: 'connected' }
  | { status: 'reconnecting' }

export abstract class SocketClient {
  onConnectionStateChanged: any = (undefined as any /* todo(lite): new BABYLON.Observable() */)
  private readonly wsSingleton = new WebSocketSingleton()
  private connectionSaga = {
    wasAbandoned: false,
    lastCloseCode: null as number | null,
    failureHistory: createRecentConnectionFailureHistory(RETRY_HISTORY_TTL),
  }

  protected constructor(
    private readonly connectionName: string,
    private readonly getConnectionUrl: () => string,
  ) {}

  get connectionState(): ConnectionState {
    if (this.isOpen) {
      return { status: 'connected' }
    } else if (this.connectionSaga.wasAbandoned) {
      return {
        status: 'disconnected',
        lastCloseCode: this.connectionSaga.lastCloseCode,
      }
    } else {
      return { status: 'reconnecting' }
    }
  }

  get isOpen(): boolean {
    return !!(this.wsSingleton.ws && this.wsSingleton.ws.readyState == WebSocket.OPEN)
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.wsSingleton.ws && this.wsSingleton.ws.readyState === WebSocket.OPEN) {
      this.wsSingleton.ws.send(data)
    }
  }

  connect(): void {
    this.connectionSaga = {
      wasAbandoned: false,
      lastCloseCode: null,
      failureHistory: createRecentConnectionFailureHistory(RETRY_HISTORY_TTL),
    }

    this._connect()
  }

  reconnect() {
    this.connectionSaga = {
      wasAbandoned: false,
      lastCloseCode: null,
      failureHistory: createRecentConnectionFailureHistory(RETRY_HISTORY_TTL),
    }

    if (this.wsSingleton.ws) {
      this.wsSingleton.ws.close(1000, 'Reconnecting to ws')
    } else {
      // If we were not connected, then manually call connect again. Otherwise, the close handler will reconnect.
      this._connect()
    }
  }

  // can be used from the console to check and mimic unconnected states, ie `connector.disconnect()`
  disconnect() {
    this.connectionSaga = {
      wasAbandoned: true,
      lastCloseCode: null,
      failureHistory: simulateConnectionFailureHistory(MAX_RECONNECT_RETRIES),
    }

    this.wsSingleton.ws?.close(1000, 'Disconnect was called')

    this._notifyConnectionStatus()
  }

  protected abstract onConnect(): void

  protected abstract onOpen(): void

  protected abstract onMessage(e: any): void

  /**
   * @param ev The close event
   * @returns A boolean to indicate whether the connection should be retried
   */
  protected abstract onClose(ev: CloseEvent): boolean

  private _onOpen() {
    this.onOpen()

    this._notifyConnectionStatus()
  }

  private _onClose(ev: CloseEvent) {
    if (this.onClose(ev)) {
      if (ev.code !== 1000) {
        this.connectionSaga.failureHistory.logConnectionFailure()
      }

      this._reconnect()
    } else {
      this.connectionSaga.wasAbandoned = true
    }

    this.connectionSaga.lastCloseCode = ev.code
    this._notifyConnectionStatus()
  }

  private _onError() {
    this._notifyConnectionStatus()
  }

  private _notifyConnectionStatus() {
    this.onConnectionStateChanged.notifyObservers(this.connectionState)
  }

  private _connect() {
    const ws = this.wsSingleton.open(this.getConnectionUrl())

    ws.binaryType = 'arraybuffer'

    ws.onopen = () => this._onOpen()
    ws.onmessage = (ev) => this.onMessage(ev)
    ws.onclose = (ev) => this._onClose(ev)
    ws.onerror = () => this._onError()

    this.onConnect()
    this._notifyConnectionStatus()
  }

  private async _reconnect() {
    const connectionSaga = this.connectionSaga
    const connectionFailureCount = connectionSaga.failureHistory.connectionFailureCount

    if (connectionFailureCount >= MAX_RECONNECT_RETRIES) {
      this.connectionSaga.wasAbandoned = true
      // eslint-disable-next-line no-console
      console.error(`gave up reconnecting to ${this.connectionName} socket after ${MAX_RECONNECT_RETRIES} tries`)
      this._notifyConnectionStatus()
      return
    }

    if (connectionFailureCount > 0) {
      const baseWaitTime = 100
      const deterministicWaitTime = Math.min(2 ** connectionFailureCount * baseWaitTime, MAX_RECONNECT_TIME)
      const jitter = Math.random() * RECONNECT_JITTER_FRACTION * deterministicWaitTime
      const waitTime = deterministicWaitTime * (1 - RECONNECT_JITTER_FRACTION) + jitter

      // eslint-disable-next-line no-console
      console.log(`reconnecting to ${this.connectionName} server in ${(waitTime / 1000.0).toFixed(1)}s`)
      await wait(waitTime)
    }

    if (this.connectionSaga === connectionSaga) {
      // Connect/reconnect hasn't been called
      this._connect()
    }
  }
}

type ConnectionFailureHistory = Readonly<{
  connectionFailureCount: number
  logConnectionFailure(): void
}>

function createRecentConnectionFailureHistory(ttlMilliseconds: number): ConnectionFailureHistory {
  let count = 0

  return {
    get connectionFailureCount() {
      return count
    },
    logConnectionFailure: () => {
      count++

      setTimeout(() => {
        count--
      }, ttlMilliseconds)
    },
  }
}

function simulateConnectionFailureHistory(retryCount: number): ConnectionFailureHistory {
  return {
    connectionFailureCount: retryCount,
    logConnectionFailure: () => {
      // Simulated connection failure logging for testing purposes
      // This implementation intentionally does nothing as it's a mock
    },
  }
}

class WebSocketSingleton {
  private _ws: WebSocket | null = null

  public get ws(): WebSocket | null {
    return this._ws
  }

  /**
   * Opens a websocket and tracks it as singleton instance. Fails if there was already an underlying websocket.
   * @param url The websocket url to connect to
   * @returns The websocket instance that is now being tracked by the singleton, for convenience. This instance is also
   * accessible at `this.ws`.
   */
  public open(url: string): WebSocket {
    if (this._ws !== null) {
      throw 'there is already a ws instance'
    }
    const ws = new WebSocket(url)

    const onClose = () => {
      this._ws = null
      ws.removeEventListener('close', onClose)
    }
    ws.addEventListener('close', onClose)

    this._ws = ws

    return this._ws
  }
}
