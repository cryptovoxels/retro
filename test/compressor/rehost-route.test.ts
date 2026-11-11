import { beforeEach, expect, it, vi } from 'vitest'
const { load, auth, compile } = vi.hoisted(() => ({ load: vi.fn(), auth: vi.fn(), compile: vi.fn() }))
vi.mock('../../server/parcel', () => ({ default: { load } }))
vi.mock('../../server/auth-parcel', () => ({ default: auth }))
vi.mock('../../compiler/src/parcel', () => ({ rehostParcel: compile }))
vi.mock('../../server/lib/query-helpers', () => ({ createRequestHandlerForQuery: vi.fn(), queryAndCallback: vi.fn() }))
vi.mock('../../server/cache', () => ({ default: vi.fn(), noCache: vi.fn() }))
vi.mock('../../server/handlers/update-parcel', () => ({ revertParcel: vi.fn(), sandboxRollback: vi.fn() }))
vi.mock('../../server/handlers/vox-export', () => ({ default: vi.fn() }))
vi.mock('../../server/lib/utils', () => ({ numberOfQuarterOfDaySinceGenesis: vi.fn() }))
vi.mock('../../server/pg', () => ({ pgp: {} }))
import routes from '../../server/controllers/parcels'

let convert: any
let handler: any
let middleware: any
beforeEach(() => {
  vi.clearAllMocks()
  const app = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn((path, ...handlers) => {
      if (path.endsWith('/nftify')) convert = handlers[1]
      if (path.endsWith('/rehost')) [middleware, handler] = handlers
    }),
    put: vi.fn(),
    delete: vi.fn(),
  }
  routes({} as any, { authenticate: (strategy: string) => strategy } as any, app as any)
  load.mockResolvedValue({ id: 4724 })
  compile.mockResolvedValue({ changed: false, missing: [] })
})

it.each(['Owner', 'Collaborator'])('allows %s and requires JWT authentication', async (role) => {
  auth.mockResolvedValue(role)
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler({ params: { id: '4724' }, user: {} }, res)
  expect(middleware).toBe('jwt')
  expect(compile).toHaveBeenCalledWith(4724)
  expect(res.json).toHaveBeenCalledWith({ success: true, changed: false, missing: [] })
})

it('rejects visitors without edit rights', async () => {
  auth.mockResolvedValue(false)
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler({ params: { id: '4724' }, user: {} }, res)
  expect(res.status).toHaveBeenCalledWith(403)
  expect(compile).not.toHaveBeenCalled()
})

it('requires owner rights to convert NFT images', async () => {
  load.mockResolvedValue({ id: 4724, content: {}, owner: 'owner' })
  auth.mockResolvedValue('Collaborator')
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await convert({ params: { id: '4724' }, user: {} }, res)
  expect(res.status).toHaveBeenCalledWith(403)
  auth.mockResolvedValue('Owner')
  await convert({ params: { id: '4724' }, user: {} }, res)
  expect(res.json).toHaveBeenCalledWith({ success: true, changed: false, count: 0 })
})
