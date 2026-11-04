import { expect, it, vi } from 'vitest'
import ChatController from '../controllers/chat'

it('binds history filters as values and preserves chronological responses', async () => {
  const query = vi.fn().mockResolvedValue({
    rows: [
      { id: 'new', text: 'new' },
      { id: 'old', text: 'old' },
    ],
  })
  const app = { get: vi.fn() }
  ChatController({ query } as any, app as any)
  const handler = app.get.mock.calls[0][1]
  const res = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler({ query: { q: "  ' OR true --  ", author: '  0xAbC  ' } }, res)
  expect(query.mock.calls[0][2]).toEqual(["' OR true --", '0xabc'])
  expect(query.mock.calls[0][1]).not.toContain("' OR true --")
  expect(res.json.mock.calls[0][0].messages.map((m: any) => m.id)).toEqual(['old', 'new'])
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-cache,no-store,must-revalidate')
})

it('bounds search input and ignores non-string filters', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] })
  const app = { get: vi.fn() }
  ChatController({ query } as any, app as any)
  const handler = app.get.mock.calls[0][1]
  const res = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() }
  await handler({ query: { q: 'a'.repeat(250), author: ['0xabc'] } }, res)
  expect(query.mock.calls[0][2]).toEqual(['a'.repeat(200), ''])
  await handler({ query: {} }, res)
  expect(query.mock.calls[1][2]).toEqual(['', ''])
})
