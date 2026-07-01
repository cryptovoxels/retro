import { useState } from 'preact/hooks'
import { app } from '../state'
import Owned from './owned'
import Unminted from './unminted'

type Tab = 'mint' | 'list'

export default function Admin(_props: { path?: string }) {
  const [tab, setTab] = useState<Tab>('mint')

  if (!app.isAdmin()) {
    return (
      <section class="admin">
        <h1>admin</h1>
        <p>you need to be on the team to see this.</p>
      </section>
    )
  }

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
      </nav>

      {tab === 'mint' && <Unminted />}
      {tab === 'list' && <Owned />}
    </section>
  )
}
