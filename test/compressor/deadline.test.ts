import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { pack, queueJob, runJob, jobSignal } from '../../compressor/src/utils'

const state = vi.hoisted(() => ({ child: undefined as any }))
vi.mock('node:child_process', async (original) => {
  const actual = await original<any>()
  return {
    ...actual,
    spawn: (_file: string, _args: string[], options: any) => {
      state.child = actual.spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], options)
      return state.child
    },
  }
})

it('kills a stuck encoder and lets the next job run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'compressor-deadline-'))
  try {
    const input = join(directory, 'input.png')
    await sharp({ create: { width: 4, height: 4, channels: 4, background: 'red' } })
      .png()
      .toFile(input)
    const start = Date.now()
    await expect(runJob(() => queueJob(() => pack({ input, output: join(directory, 'out.ktx'), type: 'astc', compression: 'ASTC_8x8', quality: 'astcfast', pot: 'no', square: 'no' })))).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(3000)
    expect(state.child.signalCode).toBe('SIGKILL')
    expect(() => process.kill(state.child.pid, 0)).toThrow()
    await expect(runJob(() => queueJob(async () => 'next'))).resolves.toBe('next')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('expires queued jobs without starting them and preserves each job deadline', async () => {
  const releases: Array<() => void> = []
  const busy = Array.from({ length: 4 }, () => runJob(() => queueJob(() => new Promise<void>((resolve) => releases.push(resolve)))))
  const work = vi.fn(async () => jobSignal().aborted)
  await expect(runJob(() => queueJob(work))).rejects.toThrow()
  expect(work).not.toHaveBeenCalled()
  releases.forEach((release) => release())
  await Promise.all(busy)
  await expect(runJob(() => queueJob(work))).resolves.toBe(false)
})
