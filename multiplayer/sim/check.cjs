const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { buildNav } = require('../src/nav.ts')
const read = (name) => readFileSync(path.join(__dirname, name), 'utf8')
async function check() {
  const { compileRig } = await import('../../scripts/critter-rig.mjs')
  assert.throws(() => compileRig(read('../../test/fixtures/critters/invalid.lua')), /unsupported expression/)

  const core = await require('./core.cjs')()
  const source = ['vector.lua', 'critter.lua', 'classes/rat.lua', 'classes/eagle.lua', 'check.lua'].map(read).join('\n')
  for (const [x, z] of [
    [0, 0],
    [-96, 640],
  ]) {
    const ground = Buffer.alloc(16 + 6 * 8, 255)
    ;[x - 1, z, 6, 1].forEach((n, i) => ground.writeInt32LE(n, i * 4))
    ground.fill(0, 16, 22)
    const roof = Buffer.alloc(2)
    roof.writeUInt16LE(1)
    // Ground layer 2 starts at y=0, above the two subterranean layers.
    ground.fill(0, 28, 34)
    buildNav(core, x, z, ground, [
      {
        x1: x,
        x2: x + 0.5,
        y1: 1.5,
        y2: 2,
        z1: z,
        z2: z + 0.5,
        voxels: require('node:zlib').deflateSync(roof).toString('base64'),
      },
    ])
    assert.equal(core.ccall('boot', 'number', ['string'], [source]), 1)
    assert.equal(
      core.ccall(
        'spawn',
        'number',
        ['string', 'number', 'number', 'number', 'number'],
        ['rat', 1, x + 0.25, 0, z + 0.25],
      ),
      1,
    )
    assert.equal(
      core.ccall('spawn', 'number', ['string', 'number', 'number', 'number', 'number'], ['rat', 2, x + 4, 0, z]),
      0,
    )
    assert.equal(
      core.ccall('spawn', 'number', ['string', 'number', 'number', 'number', 'number'], ['eagle', 3, x, 0, z]),
      1,
    )
    const xs = new Set()
    for (let n = 0; n < 100; n++) {
      const i = core._tick(1, 0.2) / 4
      assert.ok(i)
      const [px, py, pz] = core.HEAPF32.subarray(i, i + 3)
      xs.add(px)
      assert.ok(px >= x + 0.25 && px <= x + 1.75 && Math.abs(py - 0.24) < 0.0001 && pz === z + 0.25)
      assert.ok(core._tick(3, 0.2))
    }
    assert.ok(xs.size > 2)
    const square = (start, end) =>
      [
        [start, start],
        [end, start],
        [end, end],
        [start, end],
      ].map(([a, b]) => [(x + a) / 100, (z + b) / 100])
    buildNav(core, x, z, null, [], {
      id: 1,
      geometry_json: { coordinates: [square(0, 4)] },
      lakes_geometry_json: { coordinates: [[square(1, 2)]] },
    })
    assert.equal(core.ccall('boot', 'number', ['string'], [source]), 1)
    assert.equal(
      core.ccall(
        'spawn',
        'number',
        ['string', 'number', 'number', 'number', 'number'],
        ['probe', 0, x + 0.25, 0, z + 0.25],
      ),
      1,
    )
  }
  const ground = Buffer.alloc(16 + 64 * 64 * 16, 255)
  ;[0, 0, 64, 64].forEach((n, i) => ground.writeInt32LE(n, i * 4))
  ground.fill(0, 16, 16 + 64 * 64 * 3)
  const start = performance.now()
  for (let i = 0; i < 100; i++) buildNav(core, 0, 0, ground, [])
  console.log('32m voxel region, mean of 100 builds:', ((performance.now() - start) / 100).toFixed(3), 'ms')
}
check().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
