import { useEffect, useState } from 'preact/hooks'
import { micromark } from 'micromark'
import Head from './components/head'

export default function BehavioursDoc(_props: { path?: string }) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    fetch('/BEHAVIOURS.md')
      .then((r) => r.text())
      .then((md) => setHtml(micromark(md)))
      .catch(() => setHtml('<p>Behaviours documentation is missing.</p>'))
  }, [])

  return (
    <section>
      <Head title="Behaviours" />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  )
}
