import { expect, it, vi } from 'vitest'
import Parcel from '../parcel'
import db from '../pg'

it.skipIf(!process.env.TEST_POSTGRES)('changes the pack hash only when saved content changes', async () => {
  const client = await db.connect()
  try {
    await client.query('CREATE TEMP TABLE properties AS SELECT * FROM public.properties WITH NO DATA')
    await client.query('CREATE TEMP TABLE property_versions AS SELECT * FROM public.property_versions WITH NO DATA')
    await client.query("INSERT INTO properties (id, owner, address, visible, content) VALUES (-1, 'test', 'test', true, '{}')")
    vi.spyOn(db, 'query').mockImplementation(((_name: string, sql: string, values: any[]) => client.query(sql, values)) as any)
    vi.spyOn(db, 'connect').mockResolvedValue({ query: client.query.bind(client), release() {} } as any)
    const parcel = new Parcel({ id: -1, owner: 'test', visible: true, content: {} })
    async function saveHash() {
      await parcel.save()
      return (await client.query('SELECT memoized_hash FROM properties WHERE id = -1')).rows[0].memoized_hash
    }
    const first = await saveHash()
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    parcel.voxels = 'changed'
    const second = await saveHash()
    expect(second).not.toBe(first)
    expect(await saveHash()).toBe(second)
  } finally {
    vi.restoreAllMocks()
    client.release(true)
  }
})
