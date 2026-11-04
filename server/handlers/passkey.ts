import type { Request, Response } from 'express'
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server'
type AuthenticatorTransportFuture = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'
import { VoxelsUserRequest } from '../user'
import db from '../pg'
import { getUserInfo } from './sign-in'

const RP_NAME = process.env.PASSKEY_RP_NAME || 'Voxels'
const RP_ID = process.env.PASSKEY_RP_ID || 'voxels.com'
const ORIGIN = process.env.PASSKEY_ORIGIN || 'https://www.voxels.com'

// In-memory challenge store keyed by username. Good enough for stateless servers with sticky sessions
// or single-instance dev. 5 min TTL.
const challenges = new Map<string, { challenge: string; expires: number }>()

function storeChallenge(username: string, challenge: string) {
  challenges.set(username, { challenge, expires: Date.now() + 5 * 60 * 1000 })
}

function consumeChallenge(username: string): string | null {
  const entry = challenges.get(username)
  challenges.delete(username)
  if (!entry || entry.expires < Date.now()) return null
  return entry.challenge
}

export async function PasskeyAvailable(req: Request, res: Response) {
  const { username } = req.body as { username?: string }
  if (!username?.trim()) {
    res.json({ success: false, error: 'Username required' })
    return
  }
  const r = await db.query('passkey/available', 'select 1 from passkeys where username = $1', [username.trim().toLowerCase()])
  res.json({ success: true, available: r.rowCount === 0 })
}

export async function PasskeyRegisterOptions(req: Request, res: Response) {
  const { username } = req.body as { username?: string }
  if (!username?.trim()) {
    res.json({ success: false, error: 'Username required' })
    return
  }
  const name = username.trim().toLowerCase()

  const exists = await db.query('passkey/check-exists', 'select 1 from passkeys where username = $1', [name])
  if (exists.rowCount! > 0) {
    res.json({ success: false, error: 'Username taken' })
    return
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: name,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'discouraged' },
  })

  storeChallenge(name, options.challenge)
  res.json({ success: true, options })
}

export async function PasskeyRegisterVerify(req: Request, res: Response) {
  const { username, attResp } = req.body as { username?: string; attResp?: any }
  if (!username?.trim() || !attResp) {
    res.json({ success: false, error: 'Missing fields' })
    return
  }
  const name = username.trim().toLowerCase()
  const expectedChallenge = consumeChallenge(name)
  if (!expectedChallenge) {
    res.json({ success: false, error: 'Challenge expired or not found' })
    return
  }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    verification = await verifyRegistrationResponse({
      response: attResp,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    })
  } catch (e: any) {
    res.json({ success: false, error: e?.message || 'Verification failed' })
    return
  }

  if (!verification.verified || !verification.registrationInfo) {
    res.json({ success: false, error: 'Verification failed' })
    return
  }

  const { credential } = verification.registrationInfo
  const credID = Buffer.from(credential.id, 'base64url')
  const pubKey = Buffer.from(credential.publicKey)

  const uuidRow = await db.query('passkey/gen-uuid', 'SELECT uuidv7() as uuid')
  const wallet: string = uuidRow.rows[0].uuid

  await db.query('passkey/insert', 'insert into passkeys (username, user_uuid, credential_id, public_key, counter, transports) values ($1,$2,$3,$4,$5,$6)', [
    name,
    wallet,
    credID,
    pubKey,
    credential.counter,
    (credential.transports as string[]) ?? null,
  ])

  const {
    token,
    name: avatarName,
    isNewUser,
  } = await getUserInfo(res, wallet, {
    rememberSignIn: true,
    preferredDisplayName: username.trim(),
  })
  res.json({ success: true, token, name: avatarName, isNewUser })
}

export async function PasskeyLoginOptions(req: Request, res: Response) {
  const { username } = req.body as { username?: string }
  if (!username?.trim()) {
    res.json({ success: false, error: 'Username required' })
    return
  }
  const name = username.trim().toLowerCase()

  const r = await db.query('passkey/get-passkey', 'select credential_id, transports from passkeys where username = $1', [name])
  if (!r.rows[0]) {
    res.json({ success: false, error: 'Username not found' })
    return
  }

  const row = r.rows[0]
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'discouraged',
    allowCredentials: [
      {
        id: row.credential_id.toString('base64url'),
        transports: (row.transports as AuthenticatorTransportFuture[]) ?? undefined,
      },
    ],
  })

  storeChallenge(name, options.challenge)
  res.json({ success: true, options })
}

export async function PasskeyLoginVerify(req: Request, res: Response) {
  const { username, authResp } = req.body as { username?: string; authResp?: any }
  if (!username?.trim() || !authResp) {
    res.json({ success: false, error: 'Missing fields' })
    return
  }
  const name = username.trim().toLowerCase()
  const expectedChallenge = consumeChallenge(name)
  if (!expectedChallenge) {
    res.json({ success: false, error: 'Challenge expired or not found' })
    return
  }

  const r = await db.query('passkey/get-full', 'select credential_id, public_key, counter, transports, user_uuid from passkeys where username = $1', [name])
  if (!r.rows[0]) {
    res.json({ success: false, error: 'Username not found' })
    return
  }
  const row = r.rows[0]

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
  try {
    verification = await verifyAuthenticationResponse({
      response: authResp,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      credential: {
        id: (row.credential_id as Buffer).toString('base64url'),
        publicKey: new Uint8Array(row.public_key as Buffer),
        counter: Number(row.counter),
        transports: (row.transports as AuthenticatorTransportFuture[]) ?? undefined,
      },
    })
  } catch (e: any) {
    res.json({ success: false, error: e?.message || 'Verification failed' })
    return
  }

  if (!verification.verified) {
    res.json({ success: false, error: 'Verification failed' })
    return
  }

  await db.query('passkey/update-counter', 'update passkeys set counter = $1 where username = $2', [verification.authenticationInfo.newCounter, name])

  const { token, name: avatarName, isNewUser } = await getUserInfo(res, row.user_uuid, { rememberSignIn: true })
  res.json({ success: true, token, name: avatarName, isNewUser })
}

export async function PasskeyAddOptions(req: VoxelsUserRequest, res: Response) {
  const { username } = req.body as { username?: string }
  if (!username?.trim()) {
    res.json({ success: false, error: 'Username required' })
    return
  }
  const wallet = req.user?.wallet
  if (!wallet) {
    res.json({ success: false, error: 'Not signed in' })
    return
  }
  const name = username.trim().toLowerCase()
  const exists = await db.query('passkey/check-exists-add', 'select 1 from passkeys where username = $1', [name])
  if (exists.rowCount! > 0) {
    res.json({ success: false, error: 'Username taken' })
    return
  }
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: name,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'discouraged' },
  })
  storeChallenge(name, options.challenge)
  res.json({ success: true, options })
}

export async function PasskeyAddVerify(req: VoxelsUserRequest, res: Response) {
  const { username, attResp } = req.body as { username?: string; attResp?: any }
  if (!username?.trim() || !attResp) {
    res.json({ success: false, error: 'Missing fields' })
    return
  }
  const wallet = req.user?.wallet
  if (!wallet) {
    res.json({ success: false, error: 'Not signed in' })
    return
  }
  const name = username.trim().toLowerCase()
  const expectedChallenge = consumeChallenge(name)
  if (!expectedChallenge) {
    res.json({ success: false, error: 'Challenge expired or not found' })
    return
  }
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    verification = await verifyRegistrationResponse({
      response: attResp,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    })
  } catch (e: any) {
    res.json({ success: false, error: e?.message || 'Verification failed' })
    return
  }
  if (!verification.verified || !verification.registrationInfo) {
    res.json({ success: false, error: 'Verification failed' })
    return
  }
  const { credential } = verification.registrationInfo
  const credID = Buffer.from(credential.id, 'base64url')
  const pubKey = Buffer.from(credential.publicKey)
  await db.query('passkey/insert-add', 'insert into passkeys (username, user_uuid, credential_id, public_key, counter, transports) values ($1,$2::uuid,$3,$4,$5,$6)', [
    name,
    wallet,
    credID,
    pubKey,
    credential.counter,
    (credential.transports as string[]) ?? null,
  ])
  res.json({ success: true })
}
