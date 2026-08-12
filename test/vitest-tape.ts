import tape from 'tape'
import { test } from 'vitest'

// hold tape until vitest is ready, and do not process.exit the worker
tape.wait()
tape.getHarness({ exit: false })

test('tape', () => {
  return new Promise<void>((resolve, reject) => {
    tape.onFinish(() => {
      if ((tape.getHarness() as any)._exitCode) reject(new Error('tape failed'))
      else resolve()
    })
    tape.run()
  })
})
