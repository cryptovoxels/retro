import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { exitPointerLock } from '../../common/helpers/ui-helpers'
import { AddPasskey } from '../../web/src/auth/login'
import { isEmailAccount } from '../../web/src/auth/identities'
import { app, AppEvent } from '../../web/src/state'
import { welcomeStars } from './welcome-stars'

// mirrors validateName in server/handlers/update-avatar.ts
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9]{2,49}$/
// a signed-in user with no name who signed up this recently gets the welcome again after a reload
const RECENT_SIGNUP_MS = 60 * 60 * 1000

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

function Welcome({ onName, onDone }: { onName: (name: string) => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [availability, setAvailability] = useState<Availability>('idle')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef(0)

  useEffect(() => {
    onName(name)
    window.clearTimeout(timer.current)
    const trimmed = name.trim()
    if (!trimmed) {
      setAvailability('idle')
      return
    }
    if (!NAME_RE.test(trimmed)) {
      setAvailability('invalid')
      return
    }
    setAvailability('checking')
    timer.current = window.setTimeout(async () => {
      const r = await fetch('/api/account/reserve', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const j = await r.json().catch(() => ({}))
      setAvailability(j.available ? 'available' : 'taken')
    }, 300)
    return () => window.clearTimeout(timer.current)
  }, [name])

  const submit = async (e: Event) => {
    e.preventDefault()
    if (availability !== 'available' || busy) return
    setBusy(true)
    setError('')
    const r = await fetch('/api/avatar', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), settings: app.state.settings }),
    })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok || !j.success) {
      setError(j.message || 'could not save that name')
      return
    }
    await app.loadAvatar(true)
    onDone()
  }

  const hint = {
    idle: 'letters and numbers, starting with a letter',
    checking: 'checking...',
    available: 'available',
    taken: 'taken, try another',
    invalid: 'letters and numbers only, 3 to 50 characters, starting with a letter',
  }[availability]

  return (
    <section class="welcome">
      <h1>welcome to voxels</h1>
      <p>you are in. this is you, spinning. give yourself a name so people know who they are talking to.</p>
      <form onSubmit={submit}>
        <div class="f">
          <label>name</label>
          <input type="text" autofocus value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="yourname" autocapitalize="none" autocomplete="off" maxLength={50} />
          <small>{hint}</small>
        </div>
        <div class="f costume">
          <label>costume</label>
          <small>costume picker goes here</small>
        </div>
        {availability === 'available' && (
          <div class="f">
            <label>passkey</label>
            <small>skip the email code next time</small>
            <AddPasskey username={name.trim()} />
          </div>
        )}
        {error && <p>{error}</p>}
        <button type="submit" disabled={availability !== 'available' || busy}>
          {busy ? 'saving...' : 'done'}
        </button>
      </form>
    </section>
  )
}

function openWelcome(scene: BABYLON.Scene) {
  const connector = window.connector
  const controls = connector?.controls
  const persona = connector?.persona
  if (!controls || !persona) return

  const stars = welcomeStars(scene, persona)
  const wasFirstPerson = controls.firstPersonView
  if (wasFirstPerson) controls.enterThirdPerson()
  controls.camera.orbit = true
  controls.camera.autoRotate = true

  // not openDialog: that dismisses on any button click and gets swept away by requestPointerLock,
  // which would orphan the stars and camera. This dialog survives until the name is saved.
  const el = document.createElement('dialog')
  el.className = 'welcome'
  ;(document.querySelector('.client') || document.body).appendChild(el)
  exitPointerLock()

  const onDone = () => {
    render(null, el)
    el.remove()
    stars.dispose()
    controls.camera.orbit = false
    controls.camera.autoRotate = false
    if (wasFirstPerson) controls.enterFirstPerson()
  }

  render(<Welcome onName={stars.setName} onDone={onDone} />, el)
}

/** Open the in-world naming step for brand new email accounts. Wallet users keep their optional name. */
export function watchWelcome(scene: BABYLON.Scene) {
  let opened = false
  const open = () => {
    if (opened || app.state.name || !app.state.wallet || !isEmailAccount(app.state.wallet)) return
    opened = true
    openWelcome(scene)
  }

  app.on(AppEvent.Login, (isNewUser: boolean) => {
    if (isNewUser) open()
  })

  app.on(AppEvent.AvatarLoad, () => {
    if (!app.signedIn || typeof app.avatarRef === 'string') return
    const created = Date.parse(app.avatarRef.created_at)
    if (Date.now() - created < RECENT_SIGNUP_MS) open()
  })
}
