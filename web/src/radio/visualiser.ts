// Babylon shader visualiser for the radio: 6 frequency buckets. We keep 512
// steps of history (~5s) per bucket in a texture and scroll it left (handy raw
// data for future shaders), but render it stylistically as chill, dark
// blue/purple sine waves rather than a literal spectrogram.

import { isIOS } from '../../../common/helpers/detector'

const BANDS = 6
const STEPS = 512

const PALETTE = `
vec3 palette(int i) {
  if (i == 0) return vec3(0.18, 0.20, 0.45);
  if (i == 1) return vec3(0.24, 0.20, 0.52);
  if (i == 2) return vec3(0.32, 0.24, 0.58);
  if (i == 3) return vec3(0.22, 0.30, 0.60);
  if (i == 4) return vec3(0.40, 0.28, 0.62);
  return vec3(0.20, 0.34, 0.58);
}
vec3 paletteBand(float b) {
  if (b < 0.5) return vec3(0.18, 0.20, 0.45);
  if (b < 1.5) return vec3(0.24, 0.20, 0.52);
  if (b < 2.5) return vec3(0.32, 0.24, 0.58);
  if (b < 3.5) return vec3(0.22, 0.30, 0.60);
  if (b < 4.5) return vec3(0.40, 0.28, 0.62);
  return vec3(0.20, 0.34, 0.58);
}
`

const HEAD = `
precision highp float;
varying vec2 vUV;
uniform sampler2D bins;
uniform float time;
${PALETTE}
float vox(float v, float steps) { return floor(v * steps) / steps; }
vec2 vox2(vec2 p, vec2 steps) { return floor(p * steps) / steps; }
`

const SHADERS = [
  // waves
  `${HEAD}
void main() {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float lvl = texture2D(bins, vec2(1.0, (float(i) + 0.5) / 6.0)).r;
    float base = 0.13 * float(i);
    float wave = base + lvl * 0.1 * sin(vUV.x * 9.0 + time * 1.1 + float(i) * 1.7);
    float d = abs(vUV.y - wave);
    float line = smoothstep(0.3, 0.0, d) * (0.35 + lvl);
    float fill = smoothstep(0.5, 0.0, wave - vUV.y) * 0.12 * lvl;
    col += palette(i) * (line + fill);
  }
  gl_FragColor = vec4(col * 0.65, 1.0);
}`,
  // vu bars
  `${HEAD}
void main() {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float lvl = texture2D(bins, vec2(1.0, (float(i) + 0.5) / 6.0)).r;
    float cx = (float(i) + 0.5) / 6.0;
    float w = 0.07;
    if (abs(vUV.x - cx) < w) {
      float h = lvl * 0.85 + 0.05;
      if (vUV.y < h) col += palette(i) * (vUV.y / h * 0.25 + 0.15);
      float top = abs(vUV.y - h);
      col += palette(i) * smoothstep(0.04, 0.0, top) * (0.4 + lvl);
    }
  }
  gl_FragColor = vec4(col * 0.7, 1.0);
}`,
  // waterfall
  `${HEAD}
void main() {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float lvl = texture2D(bins, vec2(vUV.x, (float(i) + 0.5) / 6.0)).r;
    float row = step(float(i) / 6.0, vUV.y) * step(vUV.y, float(i + 1) / 6.0);
    col += palette(i) * lvl * row * 0.55;
    col += palette(i) * smoothstep(0.02, 0.0, abs(vUV.y - float(i + 1) / 6.0)) * lvl * 0.35;
  }
  gl_FragColor = vec4(col * 0.75, 1.0);
}`,
  // rings
  `${HEAD}
void main() {
  vec2 p = vUV - vec2(0.5, 0.5);
  float r = length(p);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float lvl = texture2D(bins, vec2(1.0, (float(i) + 0.5) / 6.0)).r;
    float rad = 0.12 + float(i) * 0.07 + lvl * 0.08 + sin(time * 0.7 + float(i)) * 0.02;
    float d = abs(r - rad);
    col += palette(i) * smoothstep(0.035, 0.0, d) * (0.25 + lvl * 0.5);
  }
  gl_FragColor = vec4(col * 0.65, 1.0);
}`,
  // scope
  `${HEAD}
void main() {
  float lvl = 0.0;
  for (int i = 0; i < 6; i++) {
    lvl += texture2D(bins, vec2(1.0, (float(i) + 0.5) / 6.0)).r;
  }
  lvl /= 6.0;
  float wave = 0.5 + (lvl - 0.5) * 0.35 * sin(vUV.x * 14.0 + time * 2.0);
  float d = abs(vUV.y - wave);
  vec3 col = palette(2) * smoothstep(0.04, 0.0, d) * (0.5 + lvl);
  col += palette(4) * smoothstep(0.12, 0.0, d) * 0.15;
  gl_FragColor = vec4(col * 0.7, 1.0);
}`,
  // drift
  `${HEAD}
void main() {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float lvl = texture2D(bins, vec2(1.0, (float(i) + 0.5) / 6.0)).r;
    float wave = 0.5 + 0.18 * sin(vUV.x * 5.0 - time * 0.6 + float(i) * 2.3) * (0.3 + lvl);
    float d = abs(vUV.y - wave);
    col += palette(i) * smoothstep(0.25, 0.0, d) * (0.2 + lvl * 0.45);
  }
  gl_FragColor = vec4(col * 0.6, 1.0);
}`,
  // vox bars - chunky columns
  `${HEAD}
void main() {
  vec2 g = vox2(vUV, vec2(18.0, 10.0));
  vec3 col = vec3(0.06, 0.07, 0.12);
  for (int i = 0; i < 6; i++) {
    float lvl = texture2D(bins, vec2(1.0, (float(i) + 0.5) / 6.0)).r;
    float cx = vox((float(i) + 0.5) / 6.0, 6.0);
    float bw = 1.0 / 6.0;
    if (g.x >= cx - bw * 0.35 && g.x <= cx + bw * 0.35) {
      float h = vox(lvl * 0.9 + 0.08, 8.0);
      if (g.y < h) {
        vec3 c = palette(i);
        float face = mod(g.x * 18.0 + g.y * 10.0, 2.0) < 1.0 ? 0.85 : 1.0;
        col = c * face * (0.35 + lvl * 0.5);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`,
  // vox terrain - stepped block waves
  `${HEAD}
void main() {
  vec2 g = vox2(vUV, vec2(24.0, 12.0));
  vec3 col = vec3(0.05, 0.06, 0.11);
  for (int i = 0; i < 6; i++) {
    float lvl = texture2D(bins, vec2(1.0, (float(i) + 0.5) / 6.0)).r;
    float wave = 0.12 + float(i) * 0.12;
    wave += vox(lvl * 0.14, 6.0) * sin(g.x * 6.28 + time * 0.9 + float(i));
    if (g.y < wave) {
      vec3 c = palette(i);
      float top = step(wave - (1.0 / 12.0), g.y);
      col = mix(c * 0.55, c * (0.9 + lvl * 0.3), top);
    }
  }
  gl_FragColor = vec4(col * 0.75, 1.0);
}`,
  // vox matrix - block grid pulse
  `${HEAD}
void main() {
  vec2 g = vox2(vUV, vec2(20.0, 12.0));
  vec2 cell = floor(vUV * vec2(20.0, 12.0));
  float band = clamp(floor((1.0 - vUV.y) * 6.0), 0.0, 5.0);
  float lvl = texture2D(bins, vec2(1.0, (band + 0.5) / 6.0)).r;
  float pulse = step(0.5, fract(sin(dot(cell, vec2(12.9898, 78.233)) + time * (1.0 + lvl)) * 43758.5453));
  pulse *= step(0.35, lvl + 0.15 * sin(time * 2.0 + cell.x * 0.7));
  vec3 col = vec3(0.04, 0.05, 0.09);
  if (pulse > 0.5) {
    vec3 c = paletteBand(band);
    float edge = step(0.92, fract(vUV.x * 20.0)) + step(0.92, fract(vUV.y * 12.0));
    col = c * (0.5 + lvl * 0.6) * (1.0 - edge * 0.35);
  }
  gl_FragColor = vec4(col, 1.0);
}`,
]

export type Visualiser = { dispose: () => void; shuffle: () => void; alive: () => boolean }

function fitCanvas(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect()
  let w = Math.floor(r.width)
  let h = Math.floor(r.height)
  if (w < 1) w = Math.floor(canvas.clientWidth) || 200
  if (h < 1) h = Math.floor(canvas.clientHeight) || 56
  const dpr = Math.min(window.devicePixelRatio || 1, isIOS() ? 1.5 : 2)
  canvas.width = Math.max(1, Math.floor(w * dpr))
  canvas.height = Math.max(1, Math.floor(h * dpr))
}

const PAL = [
  [0.18, 0.2, 0.45],
  [0.24, 0.2, 0.52],
  [0.32, 0.24, 0.58],
  [0.22, 0.3, 0.6],
  [0.4, 0.28, 0.62],
  [0.2, 0.34, 0.58],
]

function startCanvas2D(canvas: HTMLCanvasElement, analyser: AnalyserNode): Visualiser {
  const noop = { dispose: () => {}, shuffle: () => {}, alive: () => false }
  fitCanvas(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx || canvas.width < 1) return noop

  const bytes = new Uint8Array(analyser.frequencyBinCount)
  const lvls = new Float32Array(BANDS)
  let t = 0
  let raf = 0
  let dead = false

  const tick = () => {
    if (dead) return
    t += 0.016
    analyser.getByteFrequencyData(bytes)
    const n = bytes.length
    for (let i = 0; i < BANDS; i++) {
      const start = Math.floor(Math.pow(n, i / BANDS))
      const end = Math.max(start + 1, Math.floor(Math.pow(n, (i + 1) / BANDS)))
      let max = 0
      for (let j = start; j < end && j < n; j++) if (bytes[j] > max) max = bytes[j]
      lvls[i] = Math.min(1, (max / 255) * (1 + i * 0.5))
    }

    const w = canvas.width
    const h = canvas.height
    ctx.fillStyle = '#0a0b12'
    ctx.fillRect(0, 0, w, h)

    for (let i = 0; i < BANDS; i++) {
      const lvl = lvls[i]
      const [r, g, b] = PAL[i]
      const base = 0.13 * i
      ctx.strokeStyle = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${0.35 + lvl * 0.5})`
      ctx.lineWidth = Math.max(1, w / 180)
      ctx.beginPath()
      for (let x = 0; x <= w; x += 2) {
        const u = x / w
        const wave = base + lvl * 0.1 * Math.sin(u * 9 + t * 1.1 + i * 1.7)
        const y = (1 - wave) * h
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)
  return {
    alive: () => !dead,
    shuffle: () => {},
    dispose: () => {
      dead = true
      cancelAnimationFrame(raf)
    },
  }
}

export function startVisualiser(canvas: HTMLCanvasElement, analyser: AnalyserNode, mode = 0): Visualiser {
  const noop = { dispose: () => {}, shuffle: () => {}, alive: () => false }
  if (!BABYLON.Engine.isSupported()) return startCanvas2D(canvas, analyser)

  fitCanvas(canvas)
  if (canvas.width < 2 || canvas.height < 2) return noop

  let engine: BABYLON.Engine
  try {
    engine = new BABYLON.Engine(canvas, true, {
      preserveDrawingBuffer: false,
      antialias: false,
      stencil: false,
      disableWebGL2Support: isIOS(),
      doNotHandleContextLost: true,
    })
  } catch {
    return startCanvas2D(canvas, analyser)
  }
  const scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(0.04, 0.05, 0.09, 1)
  const camera = new BABYLON.FreeCamera('viz-cam', new BABYLON.Vector3(0, 0, -1), scene)
  camera.minZ = 0.01
  scene.activeCamera = camera

  const plane = BABYLON.MeshBuilder.CreatePlane('viz-bg', { size: 2 }, scene)
  plane.isPickable = false
  const bg = new BABYLON.StandardMaterial('viz-bg-m', scene)
  bg.disableLighting = true
  bg.emissiveColor = new BABYLON.Color3(0.04, 0.05, 0.09)
  bg.backFaceCulling = false
  plane.material = bg
  plane.freezeWorldMatrix()

  new BABYLON.PassPostProcess('viz-pass', 1, camera)

  const bytes = new Uint8Array(analyser.frequencyBinCount)
  const cur = new Uint8Array(BANDS)
  const data = new Uint8Array(STEPS * BANDS * 4)
  const tex = BABYLON.RawTexture.CreateRGBATexture(data, STEPS, BANDS, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE)

  let curMode = mode % SHADERS.length
  let pp: BABYLON.PostProcess | null = null
  let t = 0

  const mount = (idx: number) => {
    const next = ((idx % SHADERS.length) + SHADERS.length) % SHADERS.length
    const name = `vizradio${next}`
    BABYLON.Effect.ShadersStore[`${name}PixelShader`] = SHADERS[next]
    const prev = pp
    try {
      const nextPp = new BABYLON.PostProcess(name, name, ['time'], ['bins'], 1.0, camera)
      nextPp.onApply = (effect: any) => {
        effect.setTexture('bins', tex)
        effect.setFloat('time', t)
      }
      curMode = next
      prev?.dispose()
      pp = nextPp
    } catch {
      pp = prev
    }
  }

  const shuffle = () => {
    if (SHADERS.length < 2) return
    let next = curMode
    while (next === curMode) next = Math.floor(Math.random() * SHADERS.length)
    mount(next)
  }

  mount(curMode)
  if (!pp) {
    engine.dispose()
    scene.dispose()
    return startCanvas2D(canvas, analyser)
  }
  fitCanvas(canvas)
  engine.resize()

  const n = bytes.length

  function sample() {
    analyser.getByteFrequencyData(bytes)
    for (let i = 0; i < BANDS; i++) {
      const start = Math.floor(Math.pow(n, i / BANDS))
      const end = Math.max(start + 1, Math.floor(Math.pow(n, (i + 1) / BANDS)))
      let max = 0
      for (let j = start; j < end && j < n; j++) if (bytes[j] > max) max = bytes[j]
      cur[i] = Math.min(255, Math.round(max * (1 + i * 0.5)))
    }
  }

  function pushStep() {
    for (let y = 0; y < BANDS; y++) {
      const base = y * STEPS * 4
      data.copyWithin(base, base + 4, base + STEPS * 4)
      const li = base + (STEPS - 1) * 4
      data[li] = data[li + 1] = data[li + 2] = cur[y]
      data[li + 3] = 255
    }
  }

  engine.runRenderLoop(() => {
    t += engine.getDeltaTime() / 1000
    sample()
    pushStep()
    tex.update(data)
    scene.render()
  })

  const resize = () => {
    fitCanvas(canvas)
    engine.resize()
  }
  window.addEventListener('resize', resize, { passive: true })
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  return {
    alive: () => true,
    shuffle,
    dispose: () => {
      window.removeEventListener('resize', resize)
      ro.disconnect()
      engine.stopRenderLoop()
      pp?.dispose()
      tex.dispose()
      scene.dispose()
      engine.dispose()
    },
  }
}
