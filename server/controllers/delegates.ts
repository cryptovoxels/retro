import { verifyMessage } from 'ethers'
import { Express, Response } from 'express'
import { PassportStatic } from 'passport'
import cache from '../cache'
import { ensureAvatarExists } from '../ensure-avatar-exists'
import { emailUuid, getUserInfo, verifyEmailCode } from '../handlers/sign-in'
import { Db } from '../pg'
import { VoxelsUserRequest } from '../user'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WALLET = /^0x[0-9a-f]{40}$/i

export function delegationMessage(email: string) {
  return `I volunteer ${email} as my delegate for voxels.com.`
}

// The identity that signed in. While acting as a delegate the JWT keeps it in `account`.
function baseIdentity(req: VoxelsUserRequest): string | null {
  const id = req.user?.account ?? req.user?.wallet
  return id ? id.toLowerCase() : null
}

function denied(res: Response) {
  res.status(401).json({ success: false, error: 'Not authorized' })
}

export default function DelegatesController(db: Db, passport: PassportStatic, app: Express) {
  const jwt = passport.authenticate('jwt', { session: false })

  // Delegation rows touching an identity, from either side.
  async function linkedWallets(base: string): Promise<string[]> {
    const r = UUID.test(base)
      ? await db.query('delegations/by-user', 'select lower(wallet) as wallet from delegations where user_id = $1 order by created_at', [base])
      : await db.query('delegations/by-wallet', 'select user_id::text as wallet from delegations where wallet = $1 order by created_at', [base])
    return r.rows.map((row: { wallet: string }) => row.wallet)
  }

  app.get('/api/account/me', cache(false), jwt, async (req: VoxelsUserRequest, res) => {
    const base = baseIdentity(req)
    if (!base) return denied(res)

    const linked = await linkedWallets(base)
    const owners = [base, ...linked]
    const names = await db.query('delegations/names', 'select lower(owner) as owner, name, email from avatars where lower(owner) = any($1)', [owners])
    const byOwner = new Map<string, { name: string | null; email: string | null }>(names.rows.map((row: any) => [row.owner, row]))

    res.json({
      success: true,
      wallet: req.user!.wallet!.toLowerCase(),
      account: req.user!.account?.toLowerCase() ?? null,
      email: byOwner.get(base)?.email ?? null,
      identities: owners.map((wallet) => ({ wallet, name: byOwner.get(wallet)?.name ?? null, email: byOwner.get(wallet)?.email ?? null })),
    })
  })

  // Email account adds a wallet by proving control of it with a signed message.
  app.post('/api/delegations', jwt, async (req: VoxelsUserRequest, res) => {
    const base = baseIdentity(req)
    if (!base || !UUID.test(base)) return denied(res)

    const { signature } = req.body as { signature?: string }
    if (typeof signature !== 'string' || !signature.trim()) {
      res.status(400).json({ success: false, error: 'Signature required' })
      return
    }

    const r = await db.query('delegations/email', 'select email from avatars where lower(owner) = $1', [base])
    const email: string | null = r.rows[0]?.email ?? null
    if (!email) return denied(res)

    let wallet: string
    try {
      wallet = verifyMessage(delegationMessage(email), signature.trim()).toLowerCase()
    } catch {
      res.status(400).json({ success: false, error: 'That signature does not match the message' })
      return
    }

    await ensureAvatarExists(wallet)
    const inserted = await db.query('delegations/insert', 'insert into delegations (user_id, wallet, signature, created_at) values ($1, $2, $3, now()) on conflict (user_id, wallet) do nothing', [base, wallet, signature.trim()])
    res.json({ success: true, wallet, added: inserted.rowCount === 1 })
  })

  // Wallet account adds an email by proving it received the login code.
  app.post('/api/delegations/attach', jwt, async (req: VoxelsUserRequest, res) => {
    const base = baseIdentity(req)
    if (!base || !WALLET.test(base)) return denied(res)

    const { email, code } = req.body as { email?: string; code?: string }
    if (typeof email !== 'string' || typeof code !== 'string' || !email.trim() || !code.trim()) {
      res.status(400).json({ success: false, error: 'Email and code required' })
      return
    }

    const lower = email.trim().toLowerCase()
    if (!(await verifyEmailCode(lower, code))) {
      res.status(400).json({ success: false, error: 'Invalid code' })
      return
    }

    const uuid = await emailUuid(lower)
    const inserted = await db.query('delegations/insert-attach', 'insert into delegations (user_id, wallet, created_at) values ($1, $2, now()) on conflict (user_id, wallet) do nothing', [uuid, base])
    res.json({ success: true, wallet: uuid, added: inserted.rowCount === 1 })
  })

  app.delete('/api/delegations/:wallet', jwt, async (req: VoxelsUserRequest, res) => {
    const base = baseIdentity(req)
    if (!base) return denied(res)

    const other = req.params.wallet.toLowerCase()
    const [uuid, wallet] = UUID.test(base) ? [base, other] : [other, base]
    if (!UUID.test(uuid) || !WALLET.test(wallet)) {
      res.status(400).json({ success: false, error: 'Bad wallet' })
      return
    }

    const r = await db.query('delegations/delete', 'delete from delegations where user_id = $1 and wallet = $2', [uuid, wallet])
    res.json({ success: true, removed: r.rowCount === 1 })
  })

  // Switch the session to any linked identity. The JWT remembers the base so switching back needs no login.
  app.post('/api/delegations/appoint', jwt, async (req: VoxelsUserRequest, res) => {
    const base = baseIdentity(req)
    if (!base) return denied(res)

    const { wallet } = req.body as { wallet?: string }
    if (typeof wallet !== 'string' || !wallet.trim()) {
      res.status(400).json({ success: false, error: 'Wallet required' })
      return
    }

    const target = wallet.trim().toLowerCase()
    if (target !== base && !(await linkedWallets(base)).includes(target)) return denied(res)

    const { token, name } = await getUserInfo(res, target, { rememberSignIn: true, ...(target !== base && { account: base }) })
    res.json({ success: true, token, name })
  })
}
