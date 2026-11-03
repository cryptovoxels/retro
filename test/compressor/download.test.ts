import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { download } from '../../compressor/src/storage'
import { runJob } from '../../compressor/src/utils'

vi.mock('../../compressor/src/config', () => ({ default: { cacheDir: (name: string) => name } }))

it('aborts a trickling download at the deadline and removes the partial file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'compressor-download-'))
  const dest = join(directory, 'source')
  let closed = false
  const server = createServer((_req, res) => {
    res.writeHead(200)
    const interval = setInterval(() => res.write('slow'), 20)
    res.on('close', () => {
      closed = true
      clearInterval(interval)
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const source = `http://127.0.0.1:${(server.address() as any).port}/image`
    const start = Date.now()
    await expect(runJob(() => download({ source, id: dest } as any))).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(3000)
    await expect(access(dest)).rejects.toThrow()
    await vi.waitFor(() => expect(closed).toBe(true))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
