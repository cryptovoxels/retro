import { useEffect, useState } from 'preact/hooks'
import { ApiAvatar } from '../../../../common/messages/api-avatars'
import { AddPasskey } from '../../auth/login'
import ParcelField from '../parcel-field'
import { Spinner } from '../../spinner'
import { app } from '../../state'

type Props = {
  redirectTo?: string
  onSaved?: (avatar: ApiAvatar) => void
}

type NameStatus = 'idle' | 'checking' | 'ok' | 'invalid' | 'unavailable'

function validName(n: string) {
  return n.length >= 3 && n.length <= 50 && /^[a-zA-Z][a-zA-Z0-9]+$/.test(n)
}

async function nameFree(n: string) {
  const r = await fetch('/api/account/reserve', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: n }),
  })
  const j = await r.json()
  return !!j.available
}

export default function EditAccountForm(props: Props) {
  const [avatar, setAvatar] = useState<ApiAvatar | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [link1, setLink1] = useState('')
  const [link2, setLink2] = useState('')
  const [home, setHome] = useState<{ parcel_id?: number } | null>(null)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [nameStatus, setNameStatus] = useState<NameStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const wallet = app.state?.wallet
  const wizard = !avatar?.name

  useEffect(() => {
    if (!wallet) return
    fetch(`/api/avatars/${wallet}.json`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data: any) => {
        const a = data.avatar
        setAvatar(a)
        setName(a?.name ?? '')
        setDescription(a?.description ?? '')
        setLink1(a?.social_link_1 ?? '')
        setLink2(a?.social_link_2 ?? '')
        if (a?.home_id) setHome({ parcel_id: a.home_id })
      })
  }, [wallet])

  function goBack() {
    setStep(0)
    setNameStatus('idle')
    setError(null)
  }

  async function onNext(e: Event) {
    e.preventDefault()
    if (nameStatus === 'checking') return
    if (!validName(name.trim())) {
      setNameStatus('invalid')
      return
    }
    setNameStatus('checking')
    const free = await nameFree(name.trim())
    if (!free) {
      setNameStatus('unavailable')
      return
    }
    setNameStatus('ok')
    setTimeout(() => setStep(1), 700)
  }

  async function submit(e: Event) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const r = await fetch('/api/avatar', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name || undefined,
        description,
        social_link_1: link1,
        social_link_2: link2,
        home_id: home?.parcel_id ?? null,
      }),
    }).then((r) => r.json())
    setSaving(false)
    if (!r.success) {
      setError(r.message || 'Error')
      return
    }
    app.send({ type: 'reconnect' })
    const next = { ...avatar!, name: name || avatar?.name || null, description, social_link_1: link1, social_link_2: link2, home_id: home?.parcel_id ?? null }
    if (props.onSaved) {
      props.onSaved(next)
      return
    }
    if (props.redirectTo) window.location.href = props.redirectTo
  }

  if (wizard && step === 0) {
    const busy = nameStatus === 'checking' || nameStatus === 'ok'
    return (
      <form class="name-wizard" onSubmit={onNext}>
        <p>Welcome Avatar</p>
        <div class="name-box">
          <span class="chev">››</span>
          <input
            type="text"
            autofocus
            value={name}
            disabled={busy}
            onInput={(e: any) => {
              setName(e.target.value)
              setNameStatus('idle')
            }}
            placeholder="yourname"
            autocapitalize="none"
          />
          <span class="chev">‹‹</span>
        </div>
        {nameStatus === 'checking' && (
          <p class="name-status">
            <Spinner /> checking name...
          </p>
        )}
        {nameStatus === 'ok' && <p class="name-status ok">✓ chosen!</p>}
        {nameStatus === 'invalid' && <p class="name-status bad">invalid</p>}
        {nameStatus === 'unavailable' && <p class="name-status bad">unavailable</p>}
        <button type="submit" disabled={!name.trim() || busy}>
          next
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={submit}>
      {avatar?.name && (
        <div class="f">
          <label>username</label>
          <input type="text" value={name} disabled />
        </div>
      )}
      {wizard && name && (
        <p class="name-picked">
          {name} <small>(not saved yet)</small>
        </p>
      )}
      <div class="f">
        <label>description</label>
        <textarea value={description} rows={4} onInput={(e: any) => setDescription(e.target.value)} />
      </div>
      <div class="f">
        <label>your homepage</label>
        <input type="text" value={link1} onInput={(e: any) => setLink1(e.target.value)} placeholder="eg instagram.com/" />
        <br />
        <input type="text" value={link2} onInput={(e: any) => setLink2(e.target.value)} placeholder="tiktok.com/..." />
      </div>
      <div class="f">
        <label>home parcel</label>
        <ParcelField value={home ?? undefined} onChange={(r) => setHome(r.parcel_id ? r : null)} />
      </div>
      {error && <p>{error}</p>}
      {wizard && (
        <button type="button" onClick={goBack}>
          back
        </button>
      )}
      <button type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </button>
      {name && !wizard && (
        <>
          <hr />
          <div class="f">
            <label>add passkey</label>
            <AddPasskey username={name} />
          </div>
        </>
      )}
    </form>
  )
}
