import { isMobile } from '../../../common/helpers/detector'
import { signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { exitPointerLock } from '../../../common/helpers/ui-helpers'
import Icon from '../../../web/src/components/icons/interact'
import { DancePane } from './dance-pane'
import { EmotePane } from './emote-pane'
import { CostumePane } from './costume-pane'
import { app } from '../../../web/src/state'

const pane = signal<'dance' | 'emote' | 'costumes' | null>(null)

export function togglePopout(name: 'dance' | 'emote' | 'costumes') {
  if (name === 'costumes' && !app.signedIn) return
  exitPointerLock()
  pane.value = pane.value === name ? null : name
}

export function InteractPopout() {
  const dialog = useRef<HTMLDivElement>(null)
  const dance = useRef<HTMLButtonElement>(null)
  const emote = useRef<HTMLButtonElement>(null)
  const costumes = useRef<HTMLButtonElement>(null)
  const active = pane.value
  const close = () => {
    pane.value = null
    ;(active === 'dance' ? dance : active === 'emote' ? emote : costumes).current?.focus()
  }

  useEffect(() => {
    if (!active) return
    const dismiss = (e: PointerEvent) => {
      const target = e.target as Node
      if (!dialog.current?.contains(target) && !dance.current?.contains(target) && !emote.current?.contains(target) && !costumes.current?.contains(target)) pane.value = null
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [active])

  return (
    <>
      <button ref={dance} type="button" title="dance [G]" aria-expanded={active === 'dance'} aria-controls="interact-popout" class={active === 'dance' ? 'selected' : ''} onClick={() => togglePopout('dance')}>
        <Icon name="dance" />
      </button>
      <button ref={emote} type="button" title="emote [T]" aria-expanded={active === 'emote'} aria-controls="interact-popout" class={active === 'emote' ? 'selected' : ''} onClick={() => togglePopout('emote')}>
        <Icon name="emote" />
      </button>
      {!isMobile() && (
        <button
          ref={costumes}
          type="button"
          title={app.signedIn ? 'costumes' : 'sign in to change costumes'}
          disabled={!app.signedIn}
          aria-expanded={active === 'costumes'}
          aria-controls="interact-popout"
          class={!app.signedIn ? 'disabled' : active === 'costumes' ? 'selected' : ''}
          onClick={() => togglePopout('costumes')}
        >
          <Icon name="costumes" />
        </button>
      )}
      {active && (
        <div ref={dialog} id="interact-popout" class="interact-popout" data-pane={active} role="dialog" aria-label={active === 'dance' ? 'Dance' : active === 'emote' ? 'Emote' : 'Costumes'}>
          <button type="button" class="popout-close" aria-label="Close popout" onClick={close}>
            x
          </button>
          {active === 'dance' ? <DancePane /> : active === 'emote' ? <EmotePane /> : <CostumePane />}
        </div>
      )}
    </>
  )
}
