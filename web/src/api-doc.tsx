import { useEffect, useState } from 'preact/hooks'
import { micromark } from 'micromark'
import Head from './components/head'

export default function ApiDoc(_props: { path?: string }) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    fetch('/API.md')
      .then((r) => r.text())
      .then((md) => setHtml(micromark(md)))
      .catch(() => setHtml('<p>API documentation is missing.</p>'))
  }, [])

  return (
    <section>
      <Head title="API" description="The read-only Voxels API: parcels and their builds, womps, citizens, wearables, islands, spaces and events." />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  )
}
