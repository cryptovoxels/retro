import { Signature, type SignatureLike, verifyMessage } from 'ethers'
import type { Request, Response } from 'express'
import { SignJWT } from 'jose'
import { Resend } from 'resend'
import Avatar from '../avatar'
import { doesAvatarExist } from '../does-avatar-exist'
import { ensureAvatarExists } from '../ensure-avatar-exists'
import { isMod } from '../lib/helpers'
import { named } from '../lib/logger'
import db from '../pg'

const log = named('sign_in')
const Base24 = require('base24')

const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const JWT_SECRET_KEY = new TextEncoder().encode(JWT_SECRET)

const MESSAGE = `# Terms of Service

I agree to the terms of service (and any future revisions) detailed at:

  https://www.voxels.com/terms

I agree to follow the code of conduct detailed at

  https://www.voxels.com/conduct

  `

type MessageSignature = `${typeof MESSAGE}Date: ${string}`

type Params = any

type SignInOptions = {
  rememberSignIn?: boolean
  providerName?: string
  /** Saves to avatars.name (e.g. passkey signup username). */
  preferredDisplayName?: string
  /** Identity that signed in, kept in the JWT while acting as a delegate wallet. */
  account?: string
}

type PersonalSignIn = {
  wallet: string
  message: MessageSignature
  signature: SignatureLike
  options: SignInOptions
  email: string
  code: string
}

type SIM = PersonalSignIn

async function getEmailCode(email: string): Promise<{ code: string; expiry: string }> {
  // fixme - make dates stable in case people submit at midnight UTC
  const date = new Date().toISOString().split('T')[0]

  // fixme - dont put the salt in the public codebase?
  const salted = 'yarr-the-saltiness-' + email.toString().replace(/^\s+/, '').replace(/\s+$/, '') + '-' + date.toString()
  const key = JWT_SECRET

  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signatureBuffer = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(salted))
  const buffer = new Uint8Array(signatureBuffer)
  const code = Base24.encode24(buffer).slice(0, 5)
  const expiry = new Date().toISOString().split('T')[0]

  return { code, expiry }
}

export async function verifyEmailCode(email: string, code: string): Promise<boolean> {
  const expected = await getEmailCode(email)
  return code.trim() === expected.code
}

/** The uuid that stands in for a wallet on email accounts, creating the avatar row on first use. */
export async function emailUuid(email: string): Promise<string> {
  const r = await db.query('embedded/get-user-uuid', 'select get_or_create_user_uuid($1) as uuid', [email.toLowerCase()])
  return r.rows[0].uuid
}

export async function EmailCode(req: Request<any, any>, res: Response) {
  if (!req.body.email) {
    res.json({ success: false, error: 'Email not present' })
    return
  }

  const email = req.body.email.toString().toLowerCase()
  const pattern = /^\S+@\S+\.\S+$/

  if (!email.match(pattern)) {
    res.json({ success: false, error: 'Invalid does not match our pattern' })
    return
  }

  const { code, expiry } = await getEmailCode(email)

  const html = `
    <p>Kia Ora!</p>

    <p>Your voxels login code is:</p>

    <h1 style="padding-left: 1rem">${code}</h1>

    <p>
      ❤️ Nga Mihi - voxels.com
    </p>

    <br />

    <hr />

    <p style="opacity: 0.5">
      ps: This code is valid on ${expiry}. If you are not trying to log into voxels.com with this email, please ignore this message.
    </p>
  `

  const text = `Kia Ora!

Your voxels login code is: ${code}

<3 Nga Mihi - voxels.com

----
ps: This code is valid on ${expiry}. If you are not trying to log into voxels.com with this email, please ignore this message.
`

  console.log('sending email to', email, 'code:', code)
  console.log(text)

  const resendToken = process.env.RESEND_TOKEN
  if (!resendToken) {
    console.error('RESEND_TOKEN not set')
    res.json({ success: true })
    return
  }

  try {
    const resend = new Resend(resendToken)
    const { error } = await resend.emails.send({
      from: 'Voxels Team <team@voxels.com>',
      to: email,
      subject: `Login code ${code}`,
      text,
      html,
    })
    if (error) {
      console.error('Resend error:', error)
      res.json({ success: false, error: 'Failed to send email' })
      return
    }
  } catch (e: any) {
    console.error('Resend send failed:', e?.message ?? e)
    res.json({ success: false, error: 'Failed to send email' })
    return
  }

  res.json({ success: true })
}

export async function SignIn(req: Request<any, Params>, res: Response) {
  const params = req.body as Partial<SIM>

  if (params.email && params.code) {
    const email = params.email.toLowerCase()

    if (!(await verifyEmailCode(email, params.code))) {
      res.json({ success: false, error: 'Invalid code' })
      return
    }

    const wallet = await emailUuid(email)
    const { token, name, isNewUser } = await getUserInfo(res, wallet, {})
    res.json({ success: true, token, name, isNewUser })
    return
  }

  if (!params.message || !params.signature || !params.wallet) {
    res.json({ success: false })
    return
  }

  // The signature (message) is composed of the message + Date:[date].
  // Therefore we split the message in 2 components: Message component and Date component
  const msgComponents = params.message.split('Date: ')
  // Add seconds back into the date
  // probably unecessary
  const dateSigned = Date.parse(msgComponents[1])

  // Verify the signature message  (component 1 of the signature)
  if (msgComponents[0] !== MESSAGE) {
    log.debug('Bad message signature')
    res.json({ success: false, message: 'bad message' })
    return
  }
  // Check date of signature (+24hr within -24hr) (component 2 of the signature)
  if (dateSigned < Date.now() - 86400 * 1000 && dateSigned > Date.now() + 86400 * 1000) {
    log.debug('Bad date signature')

    res.json({ success: false, message: 'bad date' })
    return
  }

  // when personal sign
  await personalSignIn(res, params.wallet, params.message, params.signature, params.options || {})
}

async function personalSignIn(res: Response, wallet: string, message: MessageSignature, signature: SignatureLike, options: SignInOptions) {
  let sig: Signature | null = null

  let x: string | null = null
  try {
    sig = Signature.from(signature as any)
  } catch {
    log.debug('signature is invalid')
    res.json({ success: false, message: 'bad signature' })
    return
  }

  try {
    x = verifyMessage(message, sig as any)
  } catch (e) {
    log.debug("signature and message don't match")
    res.json({ success: false })
    return
  }

  if (!x || x.toLowerCase() !== wallet.toLowerCase()) {
    log.debug("Wallets don't match!")
    res.json({ success: false })
    return
  }
  const { token, name, isNewUser } = await getUserInfo(res, wallet, options)

  res.json({ success: true, token, name, isNewUser })
}

export async function CheckEmail(req: Request, res: Response) {
  const { email } = req.body as { email?: string }
  if (!email?.trim()) {
    res.json({ hasPasskey: false })
    return
  }
  const r = await db.query(
    'signin/check-email-passkey',
    `SELECT p.username FROM passkeys p
     JOIN avatars a ON p.user_uuid::text = a.owner
     WHERE lower(a.email) = lower($1) LIMIT 1`,
    [email.trim()],
  )
  const row = r.rows[0]
  res.json({ hasPasskey: !!row, passkeyUsername: row?.username ?? null })
}

export async function CheckNameAvailable(req: Request, res: Response) {
  const { name } = req.body as { name?: string }
  if (!name?.trim()) {
    res.json({ success: false, error: 'Name required' })
    return
  }
  const r = await db.query('account/check-name', 'SELECT 1 FROM avatars WHERE name ILIKE $1', [name.trim()])
  res.json({ success: true, available: r.rowCount === 0 })
}

export async function getUserInfo(res: Response, wallet: string, options: SignInOptions): Promise<{ token: string; name: string; isNewUser: boolean }> {
  if (!wallet) {
    throw new Error('Invalid wallet')
  }
  const maxAgeMs = 61 * 24 * 60 * 60 * 1000 // ~2 months
  const expiresAtMs = Date.now() + maxAgeMs

  const payload = { wallet, ...(options.account && { account: options.account }), moderator: isMod({ user: { wallet } }) }
  const token = await new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAtMs / 1000))
    .sign(JWT_SECRET_KEY)
  res.cookie('jwt', token, { ...(!!options.rememberSignIn && { maxAge: maxAgeMs }) })

  const avatarExists = await doesAvatarExist(wallet)

  // make sure we have the avatar in the DB or else new users won't get multiplayer permissions
  await ensureAvatarExists(wallet)

  let name: string | null = null
  if (avatarExists) {
    try {
      const r = await db.query('embedded/get-avatar-name', 'select name from avatars where lower(owner)=lower($1)', [wallet])
      name = r && r.rows[0] && r.rows[0].name
    } catch (e: any) {
      log.error(`sign-in.ts: ${e.toString()}`)
      name = null
    }
  } else {
    // avatar doesn't exist, it's a new user, maybe that user has an ENS name
    name = await Avatar.setENSNameIfAny(wallet)
  }

  // only apply preferredDisplayName for new users - don't clobber existing names
  const preferred = options.preferredDisplayName?.trim()
  if (preferred && !avatarExists) {
    try {
      await db.query('sign-in/avatar-prefer-display-name', 'update avatars set name = $1 where lower(owner) = lower($2)', [preferred, wallet])
      name = preferred
    } catch (e: any) {
      log.error(`sign-in preferredDisplayName: ${e.toString()}`)
    }
  }

  return { token, name: name ?? '', isNewUser: !avatarExists }
}
