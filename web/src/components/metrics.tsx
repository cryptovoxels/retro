import { groupBy } from 'lodash'
import { useEffect, useState } from 'preact/hooks'

type Metric = {
  a: string
  p: number
  t: string
}

const classname = (action: string) => {
  return `m-${action.toLowerCase()}`
}

export function ParcelMetrics(props: { parcelId: number }) {
  const id = props.parcelId

  if (!id) {
    return null
  }

  const [metrics, setMetrics] = useState<Metric[]>([])
  const onLoad = async (res: Response) => {
    const data = await res.json()

    console.log(data)

    setMetrics(data.metrics)
  }

  useEffect(() => {
    fetch(`/api/parcels/${id}/metrics`).then(onLoad)
  }, [id])

  // Group metrics by time

  let plots = []

  for (const tuple of Object.entries(groupBy(metrics, (metric: Metric) => metric.t))) {
    const [t, metrics] = tuple

    plots.push(<time>{t}</time>)

    for (const metric of metrics) {
      plots.push(<span class={classname(metric.a)}>{metric.a}</span>)
    }
  }

  return <div class="metric-plot">{plots}</div>
}
