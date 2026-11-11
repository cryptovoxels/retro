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
  const script = ['critter.lua', 'rat.lua', 'eagle.lua'].map(read).join('\n')
  const block = fs.readFileSync(path.join(__dirname, 'block.bin'))
  const boot = (vm, street, voxels, code) =>
    vm.ccall('boot', 'number', ['string', 'string', 'array', 'number'], [street, code, voxels, voxels.length])
  assert.equal(boot(core, street.join('\n'), block, script), 1)
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
  const states = new Set()
  let perch,
    breathed = false
  for (let n = 0; n < 800; n++) {
    const ptr = core._flock(0.2, 5)
    assert.ok(ptr)
    core._tick(0.2)
    const at = ptr / 4
    const state = core.ccall('bird_state', 'string', ['number'], [0])
    states.add(state)
    const pos = Array.from(core.HEAPF32.subarray(at, at + 3))
    if (state === 'perching') {
      if (perch) assert.deepEqual(pos, perch)
      perch = pos
      if (core.HEAPF32[at + 6] !== 0) breathed = true
    } else perch = null
  }
  assert.ok(breathed)
  assert.deepEqual(
    [...states].sort(),
    ['circling', 'diving', 'grabbing', 'climbing', 'approaching', 'landing', 'perching', 'cleaning'].sort(),
  )
  console.log('Henry visited all eight states; his perch stayed fixed while his idle pose changed.')

  // One floating voxel exposes all six faces. Two identical platforms have no path between them.
  const nav = await require('./core.cjs')()
  const grid = Array.from({ length: 40 }, () => Array(40).fill('.'))
  const blocks = Buffer.alloc(40 * 40 * 8)
  for (const x of [10, 11, 14]) {
    grid[10][x] = '3'
    blocks.writeUInt32LE(8, 8 * (10 * 40 + x))
  }
  const probes = `
    local origin = vec(5.25,2,5.25)
    local faces = {"+x","-x","+y","-y","+z","-z"}
    for i=1,6 do
      local hits=nav_candidates(origin,faces[i],4,false)
      if #hits~=(i<=2 and 2 or 3) then wrong_face_count() end
    end
    local reached=nav_candidates(origin,"+y",4,true)
    if #reached~=2 then crossed_gap() end
    for i=1,#reached do if reached[i].x > 6 then crossed_gap() end end
    if #nav_candidates(origin,"+y",0.1,false)~=1 then outside_radius() end
    function depart(rat)
      local hits = nav_candidates(rat_position(rat), "+y", 4, true)
      for i=1,#hits do
        if hits[i].x == 5.75 then return walk_to(rat,hits[i]) end
      end
    end
    local wake=wake_eagle
    function wake_eagle(id)
      wake(id)
      eagles[id]:enter("perching",20)
      eagles[id]:on_squawk()
      if eagles[id].state~="climbing" then missed_event() end
    end
  `
  assert.equal(boot(nav, grid.map((row) => row.join('')).join('\n'), blocks, script + '\n' + probes), 1)
  nav._reset()
  nav._flock(0.2, 5)
  assert.equal(nav.ccall('bird_state', 'string', ['number'], [0]), 'circling')
  assert.equal(nav._add(10.5, 10.5, 410, 410, 0), 0)
  nav._tick(0.2)
  for (let n = 0; n < 3; n++) nav._tick(0.2)
  assert.equal(nav.HEAPF32[nav._tick(0.2) / 4], 11.5, 'rat reached a sampled face on its own platform')
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
