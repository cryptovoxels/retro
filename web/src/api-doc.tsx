import { useEffect, useState } from 'preact/hooks'
import { micromark } from 'micromark'
import Head from './components/head'

// API.md links to its own headings and micromark gives them no ids, so put them
// back with the slug rule scripts/build-api-docs.mjs writes those links with:
// lowercase, drop punctuation but keep hyphens and underscores, spaces to hyphens.
function headingIds(html: string) {
  return html.replace(
    /<h([1-6])>(.*?)<\/h\1>/g,
    (_m, level, text) =>
      `<h${level} id="${text
        .replace(/<[^>]*>/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .replace(/ /g, '-')}">${text}</h${level}>`,
  )
}

export default function ApiDoc(_props: { path?: string }) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    fetch('/API.md')
      .then((r) => r.text())
      .then((md) => setHtml(headingIds(micromark(md))))
      .catch(() => setHtml('<p>API documentation is missing.</p>'))
  }, [])

  // The markdown arrives after the browser gave up on the hash, so scroll now.
  useEffect(() => {
    if (html) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [html])

  return (
    <section class="prose">
      <Head title="API" description="The read-only Voxels API: parcels and their builds, womps, citizens, wearables, islands, spaces and events." />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  )
}
