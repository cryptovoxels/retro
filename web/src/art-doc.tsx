import { useEffect, useState } from 'preact/hooks'
import { micromark } from 'micromark'
import Head from './components/head'

export default function ArtDoc(_props: { path?: string }) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    fetch('/ART.md', { cache: 'no-store' })
      .then((r) => r.text())
      .then((md) => setHtml(micromark(md)))
      .catch(() => setHtml('<p>Art documentation is missing.</p>'))
  }, [])

  return (
    <section class="prose art-doc">
      <Head title="Art" />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  )
}
