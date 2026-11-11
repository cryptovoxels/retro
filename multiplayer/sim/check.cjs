// Run with node multiplayer/sim/check.cjs after rebuilding the core.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8')

async function check() {
  const core = await require('./core.cjs')()
  // Block the direct route and leave a one-cell gap two metres to the east.
  const street = read('street.txt').trim().split('\n')
  street[25] = '.'.repeat(23) + '3' + '.'.repeat(16)
  assert.equal(
    core.ccall('boot', 'number', ['string', 'string'], [street.join('\n'), read('rat.lua') + '\n' + read('eagle.lua')]),
    1,
  )
  assert.equal(core._add(20.5, 20.5, 820, 1223, 0), 0)
  let collected = false,
    delivered = false
  for (let n = 0; n < 250; n++) {
    const i = core._tick(0.2) / 4
    const [x, , z, carrying] = core.HEAPF32.subarray(i, i + 4)
    assert.notEqual(street[Math.floor(z)][Math.floor(x)], '.')
    if (carrying) collected = true
    if (collected && !carrying) delivered = true
  }
  assert.ok(delivered, 'rat picks up the chip and gets it home')
  core._reset()
  core._add(20.5, 20.5, 820, 1223, 0)
  let hiddenTicks = 0
  for (let n = 0; n < 100; n++) {
    core._flock(0.2, 5)
    const at = core._tick(0.2) / 4
    if (core.HEAPF32[at + 3] < 0) hiddenTicks++
    else if (hiddenTicks) {
      assert.equal(core.HEAPF32[at], 20.5)
      assert.equal(core.HEAPF32[at + 2], 20.5)
      assert.equal(core.HEAPF32[at + 3], 0)
      break
    }
  }
  assert.ok(hiddenTicks >= 39 && hiddenTicks <= 40, 'eight seconds in the burrow after a catch')
  core._reset()
  for (let i = 0; i < 100; i++) assert.equal(core._add(20.5, 20.5, 820, 1223, i % 2), i)
  const times = []
  for (let i = 0; i < 5000; i++) {
    const start = performance.now()
    core._tick(0.2)
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  console.log(
    '100 awake rats, 5000 ticks, p95 ' +
      times[4750].toFixed(3) +
      ' ms, max ' +
      times[4999].toFixed(3) +
      ' ms, WASM heap ' +
      core.HEAPF32.byteLength / 1048576 +
      ' MiB',
  )
}
check().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
