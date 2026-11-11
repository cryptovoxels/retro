import { route } from 'preact-router'
import { useEffect, useState } from 'preact/hooks'
import { app } from '../state'
import Owned from './owned'
import Unminted from './unminted'
import SandboxesAdmin from './sandboxes'
import IslandsAdmin from './islands'

type Tab = 'mint' | 'list' | 'sandbox' | 'island'

export default function Admin(_props: { path?: string }) {
  const [tab, setTab] = useState<Exclude<Tab, 'island'>>('mint')
  useEffect(() => {
    if (_props.path === '/admin' && new URLSearchParams(location.search).has('draft')) route('/admin/island' + location.search, true)
  }, [])

  if (!app.isAdmin()) {
    return (
      <section class="admin">
        <h1>admin</h1>
        <p>you need to be on the team to see this.</p>
      </section>
    )
  }

  if (_props.path === '/admin/island') return <IslandsAdmin />
  return (
    <section class="admin">
      <h1>admin</h1>
      <nav class="admin-tabs">
        <button class={tab === 'mint' ? 'active' : ''} onClick={() => setTab('mint')}>
          mint
        </button>
        <button class={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
          list
        </button>
        <button class={tab === 'sandbox' ? 'active' : ''} onClick={() => setTab('sandbox')}>
          sandbox
        </button>
        <button onClick={() => route('/admin/island' + location.search)}>island</button>
      </nav>

      {tab === 'mint' && <Unminted />}
      {tab === 'list' && <Owned />}
      {tab === 'sandbox' && <SandboxesAdmin />}
    </section>
  )
}
