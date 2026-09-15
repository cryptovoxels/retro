import * as Comlink from 'comlink'

type Wire = { aborted: true } | { aborted: false; port: MessagePort }

let installed = false

/** Register AbortSignal so it survives Comlink postMessage (both ends, before wrap/expose). */
export function installAbort() {
  if (installed) return
  installed = true

  // Comlink only runs handlers on each RPC arg — pass AbortSignal as its own (last) argument.
  Comlink.transferHandlers.set('abortsignal', {
    canHandle(value: unknown): value is AbortSignal {
      return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal
    },
    serialize(signal: AbortSignal): [Wire, Transferable[]] {
      if (signal.aborted) return [{ aborted: true }, []]

      const { port1, port2 } = new MessageChannel()
      signal.addEventListener(
        'abort',
        () => {
          try {
            port1.postMessage({ reason: signal.reason })
          } catch {
            // port already closed
          }
        },
        { once: true },
      )
      port1.start()
      return [{ aborted: false, port: port2 }, [port2]]
    },
    deserialize(wire: Wire): AbortSignal {
      if (wire.aborted) return AbortSignal.abort()

      const ctrl = new AbortController()
      const port = wire.port
      port.addEventListener(
        'message',
        (ev) => {
          ctrl.abort(ev.data?.reason)
          port.close()
        },
        { once: true },
      )
      port.start()
      return ctrl.signal
    },
  } as Comlink.TransferHandler<AbortSignal, Wire>)
}
