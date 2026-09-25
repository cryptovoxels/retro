import { useEffect, useState } from 'preact/hooks'
import { AvatarTab } from '../../src/ui/avatar-tab'
import { DancePane } from '../../src/ui/interact/dance-pane'
import { EmotePane } from '../../src/ui/interact/emote-pane'
import { YeetPane } from '../../src/ui/interact/yeet-pane'
import { SettingsUI } from '../../src/ui/settings'

function useWorldReady() {
  const [ready, setReady] = useState(typeof window !== 'undefined' && !!window.ui)
  useEffect(() => {
    if (window.ui) {
      setReady(true)
      return
    }
    const id = setInterval(() => {
      if (!window.ui) return
      setReady(true)
      clearInterval(id)
    }, 100)
    return () => clearInterval(id)
  }, [])
  return ready
}

export function DancePage(_props: { path?: string }) {
  if (!useWorldReady()) return null
  return <DancePane />
}

export function EmotePage(_props: { path?: string }) {
  if (!useWorldReady()) return null
  return <EmotePane />
}

export function YeetPage(_props: { path?: string }) {
  if (!useWorldReady()) return null
  return <YeetPane />
}

export function AvatarPage(_props: { path?: string }) {
  if (!useWorldReady()) return null
  return <AvatarTab />
}

export function SettingsPage(_props: { path?: string }) {
  const ready = useWorldReady()
  const ui = window.ui
  if (!ready || !ui) return null
  return <SettingsUI scene={ui.props.scene} minimapSettings={ui.props.minimapSettings} />
}
