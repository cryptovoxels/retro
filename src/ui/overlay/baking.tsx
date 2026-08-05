import { useEffect, useState } from 'preact/hooks'
import Parcel from '../../parcel'
import { Spinner } from '../../../web/src/spinner'
import { onDragStart } from '../dialog'
import { UNBAKED } from '../../parcel'

type props = {
  parcel: Parcel
}

type message = {
  message: string
  timestamp: number
}
export default function Baking({ parcel }: props) {
  const [baking, setBaking] = useState(false)
  const [baked, setBaked] = useState(parcel && parcel.lightmap_url && parcel.isBaked)
  const [log, setLog] = useState<message[]>([])

  var startTime = Date.now()

  const addLog = (message: string) => {
    console.log('addLog', message)
    setLog((prev) => [...prev.slice(), { message, timestamp: Date.now() - startTime }])
  }

  const onClick = async (e: any) => {
    e.preventDefault()

    setLog([])

    startTime = Date.now()
    setBaking(true)
    addLog('Baking...')

    await parcel.requestBake(addLog)

    addLog('Baking done')
    setBaking(false)
  }

  const onUnbake = async () => {
    await parcel.unbake()
  }

  const onBakeUpdate = (url: string | null) => {
    addLog(`Lightmap update: ${url}`)
    setBaked(!!parcel?.isBaked)
  }

  useEffect(() => {
    let observer = parcel.lightmapUpdateObservable.add(onBakeUpdate)

    return () => {
      observer?.remove()
    }
  }, [])

  const lanterns = parcel.content.features
    ?.filter((f) => f.type === 'lantern')
    .map((f: any) => {
      return (
        <li>
          <input disabled type="color" value={f.color} />
          {f.color} @ {f.strength}
        </li>
      )
    })

  return (
    <section class="baking">
      <h2>Baking</h2>

      <ul class="toolbar">
        <li>{baking ? <Spinner /> : <button onClick={onClick}>Bake</button>}</li>
        <li>{baked ? <button onClick={onUnbake}>Unbake</button> : null}</li>
      </ul>

      <dl>
        <dt>Parcel</dt>
        <dd>{parcel.id}</dd>
        <dt>Lanterns</dt>
        <dd>
          <ul>{lanterns}</ul>
        </dd>
        <dt>Light map url</dt>
        <dd>{baking ? 'Baking...' : parcel.lightmap_url}</dd>
      </dl>

      <textarea value={log.map((l) => `${l.timestamp}: ${l.message}`).join('\n')} />
    </section>
  )
}
