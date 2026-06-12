import { useEffect, useState } from 'preact/hooks'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { isMobile } from '../../../common/helpers/detector'
import { consumeMetamaskLoginPending, hasMetamask, openMetamaskMobileDapp } from '../auth/login-helper'
import { login } from '../auth/state-login'
import { app, AppEvent } from '../state'

const fetchParams = {
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
} as const

async function postJSON(url: string, body: unknown) {
  const f = await fetch(url, { ...fetchParams, method: 'POST', body: JSON.stringify(body), credentials: 'include' })
  let data: any
  try {
    data = await f.json()
  } catch {
    throw new Error('Bad response from server')
  }
  if (!f.ok) {
    const msg = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : `Request failed (${f.status})`
    throw new Error(msg)
  }
  return data
}

async function checkNameAvailable(name: string): Promise<boolean> {
  const r = await fetch('/api/account/reserve', { ...fetchParams, method: 'POST', body: JSON.stringify({ name }) })
  const j = await r.json()
  return !!j.available
}

type Stage = 'email' | 'passkey' | 'code' | 'name'

export const AddPasskey = ({ username, onDone }: { username: string; onDone?: () => void }) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const onAdd = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const opts = await postJSON('/api/passkey/add/options', { username })
      if (!opts.success) {
        setError(opts.error || 'Failed')
        return
      }
      const attResp = await startRegistration({ optionsJSON: opts.options })
      const r = await postJSON('/api/passkey/add/verify', { username, attResp })
      if (!r.success) {
        setError(r.error || 'Failed')
        return
      }
      setDone(true)
      onDone?.()
    } catch (e: any) {
      setError(e?.message || 'Cancelled')
    } finally {
      setBusy(false)
    }
  }

  if (done) return <p>passkey added</p>

  return (
    <>
      {error && <p>{error}</p>}
      <button type="button" onClick={onAdd} disabled={busy}>
        {busy ? 'adding...' : 'add passkey'}
      </button>
    </>
  )
}

export const Login = ({ reason, hideHeading }: { reason?: string; hideHeading?: boolean }) => {
  const [stage, setStage] = useState<Stage>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [passkeyUsername, setPasskeyUsername] = useState('')
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [chosenName, setChosenName] = useState('')
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null)
  const [nameChecking, setNameChecking] = useState(false)
  const [mmHint, setMmHint] = useState('')

  useEffect(() => {
    const onErr = () => {
      setBusy(false)
      setMmHint('')
    }
    app.on(AppEvent.ErrorLogin, onErr)
    return () => app.off(AppEvent.ErrorLogin, onErr)
  }, [])

  useEffect(() => {
    if (!hasMetamask() || app.signedIn || !consumeMetamaskLoginPending()) return
    let dead = false
    setBusy(true)
    setMmHint('connecting wallet...')
    void login.startMetamaskLogin().finally(() => {
      if (dead) return
      setBusy(false)
      setMmHint('')
    })
    return () => {
      dead = true
    }
  }, [])

  const onContinue = async (e: Event) => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await postJSON('/api/signin/check-email', { email })
      if (r.hasPasskey) {
        setPasskeyUsername(r.passkeyUsername)
        setStage('passkey')
      } else {
        await postJSON('/api/signin/code', { email })
        setStage('code')
      }
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  const onSubmitCode = async (e: Event) => {
    e.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true)
    setError('')
    const r = await app.emailSignin(email, code)
    setBusy(false)
    if (!r) {
      setError('Invalid code')
      return
    }
    if (r.isNewUser) {
      setPendingToken(r.token)
      setPendingName(r.name)
      setStage('name')
    } else {
      app.onToken(r.token, r.name, false)
    }
  }

  const onPasskeyLogin = async () => {
    if (!passkeyUsername || busy) return
    setBusy(true)
    setError('')
    try {
      const opts = await postJSON('/api/passkey/login/options', { username: passkeyUsername })
      if (!opts.success) {
        setError(opts.error || 'Failed')
        return
      }
      const authResp = await startAuthentication({ optionsJSON: opts.options })
      const r = await postJSON('/api/passkey/login/verify', { username: passkeyUsername, authResp })
      if (!r.success) {
        setError(r.error || 'Failed')
        return
      }
      login.onToken(r.token, r.name ?? null, !!r.isNewUser)
    } catch (e: any) {
      setError(e?.message || 'Cancelled')
    } finally {
      setBusy(false)
    }
  }

  const onNameInput = async (name: string) => {
    setChosenName(name)
    setNameAvailable(null)
    if (!name.trim()) return
    setNameChecking(true)
    const avail = await checkNameAvailable(name.trim())
    setNameChecking(false)
    setNameAvailable(avail)
  }

  const onConfirmName = async (e: Event) => {
    e.preventDefault()
    if (!pendingToken || !chosenName.trim() || !nameAvailable) return
    app.onToken(pendingToken, chosenName.trim(), true)
    await fetch('/api/avatar', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: chosenName.trim() }),
    }).catch(() => {})
  }

  const onMetamask = async () => {
    if (busy) return
    if (!hasMetamask() && isMobile()) {
      setBusy(true)
      setMmHint('opening metamask app...')
      openMetamaskMobileDapp()
      return
    }
    if (!hasMetamask()) {
      window.open('https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn', '_blank', 'noopener')
      return
    }
    setBusy(true)
    setError('')
    setMmHint('approve in metamask if prompted')
    const ok = await login.startMetamaskLogin()
    setBusy(false)
    setMmHint('')
    if (!ok && !app.signedIn) setError('wallet login cancelled')
  }

  if (stage === 'name' && pendingToken) {
    return (
      <section class="login">
        <h1>choose a name</h1>
        <form onSubmit={onConfirmName}>
          <div class="f">
            <label>username</label>
            <input type="text" autofocus value={chosenName} onInput={(e) => onNameInput(e.currentTarget.value)} placeholder="yourname" autocapitalize="none" />
          </div>
          {chosenName.trim() && <p>{nameChecking ? 'checking...' : nameAvailable === true ? 'available' : nameAvailable === false ? 'taken' : ''}</p>}
          {chosenName.trim() && nameAvailable && (
            <div class="f">
              <label>passkey</label>
              <AddPasskey username={chosenName.trim()} />
            </div>
          )}
          <button type="submit" disabled={!nameAvailable || !chosenName.trim()}>
            done
          </button>
        </form>
      </section>
    )
  }

  if (stage === 'passkey') {
    return (
      <section class="login">
        <h1>log in with passkey</h1>
        <p>{email}</p>
        {error && <p>{error}</p>}
        <button type="button" onClick={onPasskeyLogin} disabled={busy}>
          {busy ? 'authenticating...' : 'use passkey'}
        </button>
        <a
          href=""
          role="button"
          onClick={(e) => {
            e.preventDefault()
            setStage('code')
            postJSON('/api/signin/code', { email }).catch(() => {})
          }}
        >
          use email code instead
        </a>
      </section>
    )
  }

  if (stage === 'code') {
    return (
      <section class="login">
        <h1>enter code</h1>
        <p>sent to {email}</p>
        <form onSubmit={onSubmitCode}>
          <div class="f">
            <label>code</label>
            <input maxLength={6} autofocus type="text" onInput={(e: any) => setCode(e.target.value)} />
          </div>
          {error && <p>{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? 'checking...' : 'log in'}
          </button>
          <a
            href=""
            role="button"
            onClick={(e) => {
              e.preventDefault()
              setStage('email')
            }}
          >
            back
          </a>
        </form>
      </section>
    )
  }

  return (
    <section class="login">
      {!hideHeading && <h1>log in{reason ? ` to ${reason}` : ''}</h1>}
      <div class="login-form">
        <div class="login-block">
          <h1>wallet</h1>
          <button type="button" onClick={onMetamask} disabled={busy}>
            <img src={'/images/metamask.png'} width={30} height={30} title={'Metamask'} alt="" />
            &nbsp;{busy ? 'connecting...' : 'Metamask'}
          </button>
          {mmHint && <p>{mmHint}</p>}
        </div>

        <hr class="login-form-divider" />

        <div class="login-block">
          <h1>email login</h1>
          <form onSubmit={onContinue}>
            <div class="f">
              <label>email</label>
              <input type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocomplete="email" autocapitalize="none" placeholder="you@example.com" />
            </div>
            {error && <p>{error}</p>}
            <button type="submit" disabled={busy || !email.trim()}>
              {busy ? 'checking...' : 'continue'}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}
