import { useEffect, useRef, useState } from 'preact/hooks'
import { AvatarIcon } from './avatar-link'
import { appoint, identityLabel, me } from '../auth/identities'
import { app } from '../state'
import { PanelType } from './panel'

export default function UserMenu() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLLIElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const ids = me.value
  const wallet = ids?.wallet || app.state.wallet || ''
  const others = ids?.identities.filter((id) => id.wallet !== wallet) || []
  const name = identityLabel(ids?.identities.find((id) => id.wallet === wallet) || { wallet, name: app.state.name || null, email: null })

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('.user-popout a')?.focus({ preventScroll: true })
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      trigger.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  const switchUser = async (wallet: string) => {
    if (busy) return
    setBusy(true)
    try {
      if (!(await appoint(wallet))) throw new Error('Switch failed')
      setOpen(false)
    } catch {
      app.showSnackbar('Could not switch identity', PanelType.Warning)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li ref={root} class="user-menu">
      <button ref={trigger} type="button" class="user-trigger" aria-label={`User: ${name}`} aria-expanded={open} aria-controls="user-popout" onClick={() => setOpen(!open)}>
        <AvatarIcon name={name} />
        <span>{name}</span>
      </button>
      {open && (
        <div id="user-popout" class="interact-popout user-popout" role="dialog" aria-label="User">
          <a href="/account" onClick={() => setOpen(false)}>
            Profile
          </a>
          {others.map((id) => (
            <button key={id.wallet} type="button" disabled={busy} onClick={() => switchUser(id.wallet)}>
              Switch to {identityLabel(id)}
            </button>
          ))}
          <a href="/logout" onClick={() => setOpen(false)}>
            Log out
          </a>
        </div>
      )}
    </li>
  )
}
