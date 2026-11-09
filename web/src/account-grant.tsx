import { useState } from 'preact/hooks'

// Lets an agent (the voxels MCP server) act as you. It opened this page with the
// key it made up; granting parks your sign-in token under that key for it to collect.
export default function Grant() {
  const key = new URLSearchParams(location.search).get('key') ?? ''
  const [done, setDone] = useState<boolean | null>(null)

  if (!/^[0-9a-f]{64}$/.test(key)) return <p>bad key</p>

  async function grant() {
    const r = await fetch('/api/account/grant', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) })
    setDone(r.ok)
  }

  if (done === true) return <p>granted. you can close this tab.</p>

  return (
    <section>
      <h1>let an agent act as you</h1>
      <p>something running on your computer wants to use voxels as you: edit your profile, your events, your collections. it will not be able to sign in or change your email.</p>
      <div class="f">
        <button type="button" onClick={grant}>
          grant
        </button>
      </div>
      {done === false && <p>that did not work, try again</p>}
    </section>
  )
}
