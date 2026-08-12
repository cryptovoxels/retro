import tape from 'tape'
import { test } from 'vitest'

// tape 5.6.4 has wait() and run(), @types/tape 5.6.0 does not know about them
const harness = tape as any

// hold tape until vitest is ready, and do not process.exit the worker
harness.wait()
tape.getHarness({ exit: false })

test('tape', () => {
  return new Promise<void>((resolve, reject) => {
    tape.onFinish(() => {
      if ((tape.getHarness() as any)._exitCode) reject(new Error('tape failed'))
      else resolve()
    })
    harness.run()
  })
})
