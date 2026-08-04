import { mat4, vec3, type Mat4, type Vec3 } from 'wgpu-matrix'
import shaderSource from './shaders/voxels.wgsl'
import blitShaderSource from './shaders/blit.wgsl'
import { fillPalette, palette } from './palette'
import { BRICK_BYTES, BRICK_WORDS, GPU_BRICK_BYTES, GPU_DIR_BYTES } from './bricks'
import {
  UNIFORM_BUFFER_SIZE,
  UNIFORM_GRID_ANCHOR_OFFSET,
  UNIFORM_TERRAIN_PARAMS_OFFSET,
  VOX_RES,
  DIR_WORDS_PER_CHUNK,
  MAX_ACTIVE_TERRAIN_CHUNKS,
  activeTerrain,
  api,
  chunkPosHalf,
  computeGridAnchor,
  directories,
  loadTerrainIndex,
  macroGridTerrain,
  pool,
  poolStats,
  slotDirectory,
  updateTerrainStreaming,
} from './terrain'
import { decodeCoords } from '../../common/helpers/utils'
import { colliderCount, died, initPhysics, move, type PhysMode, respawn, setVoxelRemoved, updateColliders } from './physics'

const FLY_SPEED = 8
const FLY_SPRINT_MULT = 2.6
const WALK_SPEED = 4.5
const WALK_SPRINT = 2
const MOUSE_SENS = 0.0022
const PITCH_LIMIT = Math.PI / 2 - 0.02
const worldUp = vec3.fromValues(0, 1, 0)
const MAT4_F32_SIZE = 16 * Float32Array.BYTES_PER_ELEMENT
const UNIFORM_VIEW_INV_OFFSET = 0
const UNIFORM_RES_TIME_OFFSET = MAT4_F32_SIZE
const PICK_GPU_BYTES = 64
const MAX_UI_LINES = 256
const GPU_LINE_STRIDE_F32 = 12
const GPU_LINE_STRIDE_BYTES = GPU_LINE_STRIDE_F32 * Float32Array.BYTES_PER_ELEMENT

export type GpuPickResult = { kind: 'miss' } | { kind: 'terrain'; chunkSlot: number; voxelCoord: Vec3; worldCoord: Vec3; normal: Vec3 }

function decodePickFromBuffer(ab: ArrayBuffer): GpuPickResult {
  const u32 = new Uint32Array(ab, 0, 4)
  const i32 = new Int32Array(ab, 16, 4)
  const f32 = new Float32Array(ab, 32, 8)
  if (u32[0] === 0) return { kind: 'miss' }
  return {
    kind: 'terrain',
    chunkSlot: u32[1],
    voxelCoord: vec3.fromValues(i32[0], i32[1], i32[2]),
    worldCoord: vec3.fromValues(f32[0], f32[1], f32[2]),
    normal: vec3.fromValues(f32[4], f32[5], f32[6]),
  }
}

function flyForward(yaw: number, pitch: number, dst: Vec3) {
  const cp = Math.cos(pitch)
  return vec3.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp, dst)
}

function makeOverlay(): { stats: HTMLElement; hint: HTMLElement; wrap: HTMLElement; dead: HTMLElement; respawnButton: HTMLButtonElement } {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:absolute;top:0;left:0;padding:1rem;z-index:2;pointer-events:auto;font:12px/1.4 monospace;color:#cfc;text-shadow:0 1px 2px #000'
  const stats = document.createElement('div')
  const hint = document.createElement('div')
  hint.textContent = 'click to fly · WASD · shift sprint · hit space to jump · [f] walk/fly · click voxel to delete · [x] exit'
  const dead = document.createElement('div')
  dead.style.display = 'none'
  dead.textContent = 'YOU ARE DEAD '
  const respawnButton = document.createElement('button')
  respawnButton.textContent = '[respawn]'
  dead.appendChild(respawnButton)
  const exit = document.createElement('button')
  exit.textContent = 'exit raycaster'
  exit.style.cssText = 'display:block;margin-top:0.5rem;pointer-events:auto'
  exit.onclick = () => {
    try {
      const raw = window.localStorage.getItem('graphicSettings')
      const s = raw ? JSON.parse(raw) : { level: 1 }
      s.raycaster = false
      window.localStorage.setItem('graphicSettings', JSON.stringify(s))
    } catch {
      /* ignore */
    }
    window.location.reload()
  }
  wrap.appendChild(stats)
  wrap.appendChild(hint)
  wrap.appendChild(dead)
  wrap.appendChild(exit)
  document.body.appendChild(wrap)
  return { stats, hint, wrap, dead, respawnButton }
}

/** spawn where the player actually is: ?coords= first, then /parcels/:id, else world origin */
async function spawnPos(): Promise<Vec3> {
  const coords = new URLSearchParams(location.search).get('coords')
  if (coords) {
    const { position } = decodeCoords(coords)
    return vec3.fromValues(position.x, position.y, position.z)
  }
  const id = location.pathname.match(/^\/parcels\/(\d+)$/)?.[1]
  if (id) {
    try {
      const p = (await (await fetch(api(`/grid/parcels/${id}`))).json())?.parcel
      if (p) return vec3.fromValues((p.x1 + p.x2) / 2, p.y1 + 4, (p.z1 + p.z2) / 2)
    } catch {
      /* fall through to origin */
    }
  }
  return vec3.fromValues(0, 4, 8)
}

export async function bootRaycast(canvas: HTMLCanvasElement) {
  if (!navigator.gpu) {
    console.error('raycaster: WebGPU not available')
    return
  }

  // stop the browser from smoothing our chunky pixels if anything scales the element
  canvas.style.imageRendering = 'pixelated'

  const { stats: statsOverlay, wrap: overlay, dead: deadOverlay, respawnButton } = makeOverlay()
  const flyCam = {
    pos: vec3.fromValues(0, 4, 8),
    yaw: 0,
    pitch: -0.3,
  }
  const keysDown = new Set<string>()
  let mode: PhysMode = 'fly'
  // quarter-res compute, nearest blit; canvas backing store is CSS pixels (no retina)
  const renderScale = 0.25

  window.addEventListener('keydown', (e) => {
    keysDown.add(e.code)
    if (e.code === 'KeyF' && !e.repeat) {
      mode = mode === 'fly' ? 'walk' : 'fly'
    }
    if (e.code === 'KeyX') {
      try {
        const raw = window.localStorage.getItem('graphicSettings')
        const s = raw ? JSON.parse(raw) : { level: 1 }
        s.raycaster = false
        window.localStorage.setItem('graphicSettings', JSON.stringify(s))
      } catch {
        /* ignore */
      }
      window.location.reload()
    }
  })
  window.addEventListener('keyup', (e) => keysDown.delete(e.code))
  canvas.addEventListener('click', () => canvas.requestPointerLock())
  canvas.addEventListener('mousemove', (e) => {
    if ((document.pointerLockElement as any) !== canvas) return
    flyCam.yaw -= e.movementX * MOUSE_SENS
    flyCam.pitch -= e.movementY * MOUSE_SENS
    flyCam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, flyCam.pitch))
  })

  const bakedChunks = await loadTerrainIndex()

  const spawn = await spawnPos()
  vec3.copy(spawn, flyCam.pos)
  console.log('raycaster: spawn', flyCam.pos[0].toFixed(1), flyCam.pos[1].toFixed(1), flyCam.pos[2].toFixed(1), 'baked chunks', bakedChunks)
  void initPhysics([flyCam.pos[0], flyCam.pos[1], flyCam.pos[2]])
  let dead = false
  respawnButton.onclick = () => {
    dead = false
    mode = 'walk'
    deadOverlay.style.display = 'none'
    vec3.copy(spawn, flyCam.pos)
    respawn(spawn)
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) {
    console.error('raycaster: no GPU adapter')
    return
  }
  const device = await adapter.requestDevice()
  const gpuContext = canvas.getContext('webgpu')
  if (!gpuContext) {
    console.error('raycaster: no webgpu context')
    return
  }
  const context = gpuContext
  const format = navigator.gpu.getPreferredCanvasFormat()

  const uniformBuffer = device.createBuffer({
    size: UNIFORM_BUFFER_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const chunkPosBuffer = device.createBuffer({
    size: chunkPosHalf.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const macroGridBuffer = device.createBuffer({
    size: macroGridTerrain.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const directoriesBuffer = device.createBuffer({
    size: GPU_DIR_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const brickPoolBuffer = device.createBuffer({
    size: GPU_BRICK_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  // seed brick 0 (watea) as air
  device.queue.writeBuffer(brickPoolBuffer, 0, pool.words.subarray(0, BRICK_WORDS))
  const paletteBuffer = device.createBuffer({
    size: palette.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  const uiLinesBuffer = device.createBuffer({
    size: MAX_UI_LINES * GPU_LINE_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const uiUniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const pickGpuBuffer = device.createBuffer({
    size: PICK_GPU_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const pickReadBuffer = device.createBuffer({
    size: PICK_GPU_BYTES,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })
  const uiLinesCpu = new Float32Array(MAX_UI_LINES * GPU_LINE_STRIDE_F32)
  const uiUniformU32 = new Uint32Array([0, 0, 0, 0])

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: shaderSource }),
      entryPoint: 'cs_main',
    },
  })
  const blitPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({ code: blitShaderSource }),
      entryPoint: 'vs_main',
    },
    fragment: {
      module: device.createShaderModule({ code: blitShaderSource }),
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  })
  const blitSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' })

  let outputTexture: GPUTexture | undefined
  let computeBindGroup!: GPUBindGroup
  let blitBindGroup!: GPUBindGroup
  let internalRenderWidth = 1
  let internalRenderHeight = 1

  const recreateScreenTargets = () => {
    // CSS pixels only — no devicePixelRatio. compute runs at renderScale, blit nearest-upsamples.
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.floor(rect.width || window.innerWidth))
    canvas.height = Math.max(1, Math.floor(rect.height || window.innerHeight))
    internalRenderWidth = Math.max(1, Math.floor(canvas.width * renderScale))
    internalRenderHeight = Math.max(1, Math.floor(canvas.height * renderScale))
    context.configure({ device, format, alphaMode: 'opaque' })
    if (outputTexture) outputTexture.destroy()
    outputTexture = device.createTexture({
      size: { width: internalRenderWidth, height: internalRenderHeight },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    })
    const outputView = outputTexture.createView()
    computeBindGroup = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: chunkPosBuffer } },
        { binding: 2, resource: { buffer: macroGridBuffer } },
        { binding: 3, resource: { buffer: directoriesBuffer } },
        { binding: 4, resource: { buffer: paletteBuffer } },
        { binding: 5, resource: outputView },
        { binding: 10, resource: { buffer: uiLinesBuffer } },
        { binding: 11, resource: { buffer: pickGpuBuffer } },
        { binding: 12, resource: { buffer: uiUniformBuffer } },
        { binding: 13, resource: { buffer: brickPoolBuffer } },
      ],
    })
    blitBindGroup = device.createBindGroup({
      layout: blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: outputView },
        { binding: 1, resource: blitSampler },
      ],
    })
  }
  const syncScreen = () => {
    const host = canvas.parentElement
    if (host && overlay.parentElement !== host) host.appendChild(overlay)
    recreateScreenTargets()
  }
  syncScreen()
  window.addEventListener('resize', syncScreen)
  new ResizeObserver(syncScreen).observe(canvas as any)
  // <Client>.track calls engine.resize when the push-panel slot changes
  ;(window as any).engine = { resize: syncScreen }

  fillPalette()
  device.queue.writeBuffer(paletteBuffer, 0, palette)
  device.queue.writeBuffer(pickGpuBuffer, 0, new Uint8Array(PICK_GPU_BYTES))

  let lastGpuPick: GpuPickResult = { kind: 'miss' }
  let pickMapChain: Promise<void> = Promise.resolve()
  const uniformBytes = new ArrayBuffer(UNIFORM_BUFFER_SIZE)
  const uniformF32 = new Float32Array(uniformBytes)
  const uniformI32 = new Int32Array(uniformBytes, UNIFORM_GRID_ANCHOR_OFFSET, 4)
  const uniformU32 = new Uint32Array(uniformBytes, UNIFORM_TERRAIN_PARAMS_OFFSET, 4)

  const tmpForward: Vec3 = vec3.create()
  const tmpRight: Vec3 = vec3.create()
  const tmpMove: Vec3 = vec3.create()
  const tmpTarget: Vec3 = vec3.create()
  const tmpEye: Vec3 = vec3.create()
  let lastFrameTimeMs = 0
  let lastRafWallMs = 0
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (lastGpuPick.kind !== 'terrain') return
    const { chunkSlot, voxelCoord, worldCoord } = lastGpuPick
    const cx = Math.floor(voxelCoord[0])
    const cy = Math.floor(voxelCoord[1])
    const cz = Math.floor(voxelCoord[2])
    const dir = slotDirectory(chunkSlot)
    const brickId = pool.setVoxel(dir, cx, cy, cz, 0xff)
    device.queue.writeBuffer(directoriesBuffer, chunkSlot * DIR_WORDS_PER_CHUNK * 4, dir)
    if (brickId) {
      device.queue.writeBuffer(brickPoolBuffer, brickId * BRICK_BYTES, pool.words.subarray(brickId * BRICK_WORDS, (brickId + 1) * BRICK_WORDS))
    }
    setVoxelRemoved(worldCoord[0], worldCoord[1], worldCoord[2])
  })

  async function render(time: number) {
    const wallStart = performance.now()
    const frameMs = lastRafWallMs > 0 ? wallStart - lastRafWallMs : 0
    await pickMapChain

    const seconds = time * 0.001
    const dt = lastFrameTimeMs > 0 ? Math.min(0.05, (time - lastFrameTimeMs) * 0.001) : 0
    lastFrameTimeMs = time

    if (!dead && (document.pointerLockElement as any) === canvas) {
      flyForward(flyCam.yaw, flyCam.pitch, tmpForward)
      vec3.normalize(vec3.cross(tmpForward, worldUp, tmpRight), tmpRight)
      vec3.zero(tmpMove)
      let forwardAmt = 0
      let strafeAmt = 0
      if (keysDown.has('KeyW')) forwardAmt += 1
      if (keysDown.has('KeyS')) forwardAmt -= 1
      if (keysDown.has('KeyD')) strafeAmt += 1
      if (keysDown.has('KeyA')) strafeAmt -= 1
      if (mode === 'fly') {
        if (keysDown.has('Space')) tmpMove[1] += 1
        if (keysDown.has('ControlLeft') || keysDown.has('KeyC')) tmpMove[1] -= 1
        vec3.addScaled(tmpMove, tmpForward, forwardAmt, tmpMove)
        vec3.addScaled(tmpMove, tmpRight, strafeAmt, tmpMove)
      } else {
        // walk: horizontal only from yaw
        const flat = vec3.set(-Math.sin(flyCam.yaw), 0, -Math.cos(flyCam.yaw), tmpForward)
        vec3.normalize(vec3.cross(flat, worldUp, tmpRight), tmpRight)
        vec3.addScaled(tmpMove, flat, forwardAmt, tmpMove)
        vec3.addScaled(tmpMove, tmpRight, strafeAmt, tmpMove)
        tmpMove[1] = 0
      }
      if (vec3.lengthSq(tmpMove) > 1e-8) vec3.normalize(tmpMove, tmpMove)
      const sprint = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight')
      const speed = mode === 'fly' ? FLY_SPEED * (sprint ? FLY_SPRINT_MULT : 1) : WALK_SPEED * (sprint ? WALK_SPRINT : 1)
      const next = move(dt, flyCam.pos, {
        wish: [tmpMove[0], tmpMove[1], tmpMove[2]],
        speed,
        jump: mode === 'walk' && keysDown.has('Space'),
        mode,
      })
      vec3.set(next[0], next[1], next[2], flyCam.pos)
      if (died()) {
        dead = true
        deadOverlay.style.display = 'block'
        document.exitPointerLock()
      }
    }

    updateColliders(flyCam.pos)
    const anchor = computeGridAnchor(flyCam.pos)
    const terrain = updateTerrainStreaming(flyCam.pos, anchor)
    if (terrain.dirtyBricks.length || terrain.dirtySlots.length || terrain.macroDirty) {
      for (const id of terrain.dirtyBricks) {
        if (id <= 0) continue
        device.queue.writeBuffer(brickPoolBuffer, id * BRICK_BYTES, pool.words.subarray(id * BRICK_WORDS, (id + 1) * BRICK_WORDS))
      }
      for (const slot of terrain.dirtySlots) {
        const start = slot * DIR_WORDS_PER_CHUNK
        device.queue.writeBuffer(directoriesBuffer, start * 4, directories.subarray(start, start + DIR_WORDS_PER_CHUNK))
      }
      device.queue.writeBuffer(chunkPosBuffer, 0, chunkPosHalf)
      if (terrain.macroDirty) device.queue.writeBuffer(macroGridBuffer, 0, macroGridTerrain)
    }

    flyForward(flyCam.yaw, flyCam.pitch, tmpForward)
    vec3.copy(flyCam.pos, tmpEye)
    vec3.add(flyCam.pos, tmpForward, tmpTarget)
    const view = mat4.lookAt(tmpEye, tmpTarget, worldUp)
    const viewInv: Mat4 = mat4.inverse(view)

    uniformF32.set(viewInv, UNIFORM_VIEW_INV_OFFSET / Float32Array.BYTES_PER_ELEMENT)
    const resTimeBase = UNIFORM_RES_TIME_OFFSET / Float32Array.BYTES_PER_ELEMENT
    uniformF32[resTimeBase + 0] = internalRenderWidth
    uniformF32[resTimeBase + 1] = internalRenderHeight
    uniformF32[resTimeBase + 2] = seconds
    uniformF32[resTimeBase + 3] = 0
    uniformI32[0] = anchor[0]
    uniformI32[1] = anchor[1]
    uniformI32[2] = anchor[2]
    uniformI32[3] = 0

    uniformU32[0] = activeTerrain.length
    uniformU32[1] = DIR_WORDS_PER_CHUNK
    uniformU32[2] = VOX_RES
    uniformU32[3] = 0
    device.queue.writeBuffer(uniformBuffer, 0, uniformBytes)

    uiUniformU32[0] = 0
    device.queue.writeBuffer(uiUniformBuffer, 0, uiUniformU32)
    void uiLinesCpu

    const encoder = device.createCommandEncoder()
    const computePass = encoder.beginComputePass()
    computePass.setPipeline(computePipeline)
    computePass.setBindGroup(0, computeBindGroup)
    computePass.dispatchWorkgroups(Math.ceil(internalRenderWidth / 8), Math.ceil(internalRenderHeight / 8))
    computePass.end()
    encoder.copyBufferToBuffer(pickGpuBuffer, 0, pickReadBuffer, 0, PICK_GPU_BYTES)
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.01, g: 0.015, b: 0.025, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(blitPipeline)
    pass.setBindGroup(0, blitBindGroup)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])

    pickMapChain = new Promise<void>((resolve) => {
      device.queue.onSubmittedWorkDone().then(() => {
        void pickReadBuffer.mapAsync(GPUMapMode.READ).then(() => {
          const ab = pickReadBuffer.getMappedRange().slice(0)
          lastGpuPick = decodePickFromBuffer(ab)
          pickReadBuffer.unmap()
          resolve()
        })
      })
    })

    lastRafWallMs = wallStart
    const fpsEst = frameMs > 1e-6 ? 1000 / frameMs : 0
    const ps = poolStats()
    statsOverlay.innerHTML = `raycaster · ${fpsEst.toFixed(0)} Hz · ${mode}<br/>chunks ${activeTerrain.length}/${MAX_ACTIVE_TERRAIN_CHUNKS}${ps.macroOverflow ? ` · macro overflow ${ps.macroOverflow}` : ''} · phys ${colliderCount()}<br/>bricks ${ps.used} (${(ps.bytes / (1024 * 1024)).toFixed(1)}MB) dedup ${ps.dedupHits}<br/>pos ${flyCam.pos[0].toFixed(1)}, ${flyCam.pos[1].toFixed(1)}, ${flyCam.pos[2].toFixed(1)}`

    requestAnimationFrame((t) => void render(t))
  }

  requestAnimationFrame((t) => void render(t))
}
