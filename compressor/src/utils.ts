import { AsyncLocalStorage } from 'node:async_hooks'
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import PQueue from 'p-queue'

const jobs = new AsyncLocalStorage<AbortSignal>()
const queues = {
  fetch: new PQueue({ concurrency: 32 }),
  process: new PQueue({ concurrency: 8 }),
  upload: new PQueue({ concurrency: 16 }),
}
const binaries = join(dirname(createRequire(import.meta.url).resolve('texture-compressor/package.json')), 'bin', process.platform)

export function jobSignal() {
  const signal = jobs.getStore() || AbortSignal.timeout(10000)
  signal.throwIfAborted()
  return signal
}

export function runJob<T>(work: () => Promise<T>) {
  return jobs.run(AbortSignal.timeout(10000), work)
}

export function queueJob<T>(work: () => Promise<T>, stage: keyof typeof queues = 'process'): Promise<T> {
  const queue = queues[stage]
  const signal = jobSignal()
  if (queue.size >= 128) return Promise.reject(Object.assign(new Error('compressor queue full'), { name: 'OverloadError' }))
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    queue
      .add(() => {
        signal.removeEventListener('abort', abort)
        signal.throwIfAborted()
        return jobs.run(signal, work)
      })
      .then((value) => resolve(value as T), reject)
  })
}

export async function pack(options: any) {
  const signal = jobSignal()
  const { width = 1 } = await sharp(options.input).timeout({ seconds: 10 }).metadata()
  const mips = String(Math.floor(Math.log2(width)) + 1)
  const dxt = options.type === 's3tc'
  const args = dxt
    ? ['-file', options.input, '-out', options.output, '-fileformat', 'ktx', `-${options.compression}`, '-dxtQuality', options.quality, '-helperThreads', '1', '-mipMode', 'Generate', '-maxmips', mips]
    : [
        '-i',
        options.input,
        '-o',
        options.output,
        '-f',
        options.compression,
        '-q',
        options.quality,
        '-j',
        '1',
        '-m',
        mips,
        ...(options.pot === 'no' ? [] : ['-pot', options.pot]),
        ...(options.square === 'no' ? [] : ['-square', options.square]),
      ]
  signal.throwIfAborted()
  // Kill the encoder itself; rejecting a promise leaves it burning CPU.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(dxt ? join(binaries, 'crunch') : process.env.PVRTEXTOOL || 'PVRTexToolCLI', args, { stdio: 'ignore', detached: true })
    const abort = () => {
      if (!child.pid) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    signal.addEventListener('abort', abort, { once: true })
    child.once('error', reject)
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else if (code !== 0) reject(new Error(`Encoder exited with ${code}`))
      else resolve()
    })
  }).catch(async (error) => {
    await rm(options.output, { force: true })
    throw error
  })
}
