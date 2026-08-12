import tape from 'tape'
import { test } from 'vitest'

// hold tape until vitest is ready, and do not process.exit the worker
const t = tape as any
t.wait()
t.getHarness({ exit: false })

test('tape', () => {
  return new Promise<void>((resolve, reject) => {
    t.onFinish(() => {
      if (t.getHarness()._exitCode) reject(new Error('tape failed'))
      else resolve()
    })
    t.run()
  })
})
