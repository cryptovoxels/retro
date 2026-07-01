import { useEffect } from 'preact/hooks'
import { ChatPanel } from '../../src/ui/interact/chat'
import { sidebarClosed } from '../../src/store'
import { getCoords } from './helpers/coords-nav'

export function ChatPage(_props: { path?: string }) {
  useEffect(() => {
    document.body.classList.toggle('chat-route', true)
    if (getCoords()) sidebarClosed.value = false
    return () => document.body.classList.remove('chat-route')
  }, [])

  return (
    <section class="chat-page">
      <h1>chat</h1>
      <ChatPanel cap={1000} variant="page" />
    </section>
  )
}
