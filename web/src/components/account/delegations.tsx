import type { MetaMaskInpageProvider } from '@metamask/providers'
import { useEffect, useState } from 'preact/hooks'
import { copyTextToClipboard } from '../../../../common/helpers/utils'
import { getUserAccounts, hasMetamask, signMessage } from '../../auth/login-helper'
import { appoint, identityLabel, isEmailAccount, loadMe, me as meSignal } from '../../auth/identities'
import { app } from '../../state'
import AvatarImage from '../avatar-image'
import { PanelType } from '../panel'

const jsonHeaders = { Accept: 'application/json', 'Content-Type': 'application/json' } as const

async function post(url: string, body: unknown, method = 'POST'): Promise<{ success: boolean; error?: string }> {
  const f = await fetch(url, { method, credentials: 'include', headers: jsonHeaders, body: JSON.stringify(body) })
  const j = await f.json().catch(() => null)
  if (!j) return { success: false, error: `Request failed (${f.status})` }
  return j
}

// Must match delegationMessage in server/controllers/delegates.ts
const delegationMessage = (email: string) => `I volunteer ${email} as my delegate for voxels.com.`

export default function Delegations() {
  const me = meSignal.value
  const [busy, setBusy] = useState('')

  const reload = async () => {
    await loadMe(true)
  }

  useEffect(() => {
    void loadMe()
  }, [])

  if (!me) return null

  const base = me.account ?? me.wallet
  const emailAccount = isEmailAccount(base)

  const onUse = async (wallet: string) => {
    setBusy(wallet)
    const ok = await appoint(wallet)
    setBusy('')
    if (!ok) app.showSnackbar('Could not switch identity', PanelType.Warning)
  }

  const onRemove = async (wallet: string) => {
    if (!confirm('Unlink this identity? You can link it again later.')) return
    setBusy(wallet)
    const r = await post(`/api/delegations/${wallet}`, {}, 'DELETE')
    setBusy('')
    if (!r.success) {
      app.showSnackbar(r.error ?? 'Could not unlink', PanelType.Warning)
      return
    }
    await reload()
  }

  return (
    <>
      <h2>identities</h2>
      <p>
        {emailAccount ? (
          <>
            you signed in with <b>{me.email}</b>. link a crypto wallet and you can switch to it without metamask next time.
          </>
        ) : (
          <>you signed in with your wallet. link an email and you can sign in with a code when metamask is out of reach.</>
        )}
      </p>
      <ul class="identities">
        {me.identities.map((id) => {
          const current = id.wallet === me.wallet
          return (
            <li key={id.wallet}>
              <AvatarImage wallet={id.wallet} size={24} /> {identityLabel(id)}{' '}
              {current ? (
                <small>(you, right now)</small>
              ) : (
                <>
                  <button type="button" disabled={!!busy} onClick={() => onUse(id.wallet)}>
                    {busy === id.wallet ? 'switching...' : 'use'}
                  </button>{' '}
                  {id.wallet !== base && (
                    <a href="" role="button" onClick={(e) => (e.preventDefault(), onRemove(id.wallet))}>
                      unlink
                    </a>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
      {emailAccount ? <AddWallet email={me.email ?? ''} onAdded={reload} /> : <AddEmail onAdded={reload} />}
    </>
  )
}

function AddWallet({ email, onAdded }: { email: string; onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [signature, setSignature] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const message = delegationMessage(email)

  const submit = async (sig: string) => {
    setBusy(true)
    setError('')
    const r = await post('/api/delegations', { signature: sig })
    setBusy(false)
    if (!r.success) {
      setError(r.error ?? 'Could not link wallet')
      return
    }
    setSignature('')
    setOpen(false)
    await onAdded()
  }

  const onMetamask = async () => {
    const provider = window.ethereum as MetaMaskInpageProvider
    setBusy(true)
    setError('')
    const accounts = await getUserAccounts(provider)
    if (!accounts?.[0]) {
      setBusy(false)
      setError('metamask did not give us a wallet')
      return
    }
    const sig = await signMessage(provider, accounts[0], message)
    if (!sig) {
      setBusy(false)
      setError('signing cancelled')
      return
    }
    await submit(sig)
  }

  const copy = () =>
    copyTextToClipboard(
      message,
      () => app.showSnackbar('Copied message', PanelType.Success),
      () => app.showSnackbar('Could not copy', PanelType.Info),
    )

  if (!open) {
    return (
      <p>
        <button type="button" onClick={() => setOpen(true)}>
          link a wallet
        </button>
      </p>
    )
  }

  return (
    <form
      class="add-delegate"
      onSubmit={(e) => {
        e.preventDefault()
        if (signature.trim()) submit(signature.trim())
      }}
    >
      <h3>link a wallet</h3>
      <p>sign this exact message with the wallet you want to link. nothing is sent to the chain and it costs nothing.</p>
      <div class="f">
        <label>message to sign</label>
        <textarea readOnly value={message} onClick={copy} title="click to copy" />
      </div>
      {hasMetamask() && (
        <div class="f">
          <label>metamask</label>
          <button type="button" disabled={busy} onClick={onMetamask}>
            {busy ? 'waiting for metamask...' : 'sign with metamask'}
          </button>
        </div>
      )}
      <div class="f">
        <label>or paste a signature</label>
        <textarea value={signature} onInput={(e) => setSignature(e.currentTarget.value)} placeholder="0x..." />
        <small>
          copy the message into{' '}
          <a href="https://etherscan.io/verifiedSignatures" target="_blank" rel="noopener">
            etherscan verified signatures
          </a>{' '}
          (sign message), sign it with any wallet, and paste the signature hash here. old torus users: sign in at{' '}
          <a href="https://app.tor.us/" target="_blank" rel="noopener">
            app.tor.us
          </a>{' '}
          and connect it to etherscan with walletconnect.
        </small>
      </div>
      {error && <p>{error}</p>}
      <button type="submit" disabled={busy || !signature.trim()}>
        {busy ? 'linking...' : 'link wallet'}
      </button>{' '}
      <a href="" role="button" onClick={(e) => (e.preventDefault(), setOpen(false))}>
        cancel
      </a>
    </form>
  )
}

function AddEmail({ onAdded }: { onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const sendCode = async (e: Event) => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setError('')
    const r = await post('/api/signin/code', { email: email.trim() })
    setBusy(false)
    if (!r.success) {
      setError(r.error ?? 'Could not send code')
      return
    }
    setSent(true)
  }

  const attach = async (e: Event) => {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setError('')
    const r = await post('/api/delegations/attach', { email: email.trim(), code: code.trim() })
    setBusy(false)
    if (!r.success) {
      setError(r.error ?? 'Could not link email')
      return
    }
    setOpen(false)
    setSent(false)
    setEmail('')
    setCode('')
    await onAdded()
  }

  if (!open) {
    return (
      <p>
        <button type="button" onClick={() => setOpen(true)}>
          link an email
        </button>
      </p>
    )
  }

  return (
    <form class="add-delegate" onSubmit={sent ? attach : sendCode}>
      <h3>link an email</h3>
      <div class="f">
        <label>email</label>
        <input type="email" value={email} disabled={sent} onInput={(e) => setEmail(e.currentTarget.value)} autocomplete="email" autocapitalize="none" />
      </div>
      {sent && (
        <div class="f">
          <label>code we sent to {email}</label>
          <input type="text" maxLength={6} autofocus value={code} onInput={(e) => setCode(e.currentTarget.value)} inputMode="numeric" autocomplete="one-time-code" />
        </div>
      )}
      {error && <p>{error}</p>}
      <button type="submit" disabled={busy || (sent ? !code.trim() : !email.trim())}>
        {busy ? 'working...' : sent ? 'link email' : 'send code'}
      </button>{' '}
      <a href="" role="button" onClick={(e) => (e.preventDefault(), setOpen(false), setSent(false))}>
        cancel
      </a>
    </form>
  )
}
