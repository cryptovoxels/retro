// Babylon shader visualiser for the radio: 6 frequency buckets. We keep 512
// steps of history (~5s) per bucket in a texture and scroll it left (handy raw
// data for future shaders), but render it stylistically as chill, dark
// blue/purple sine waves rather than a literal spectrogram.

const BANDS = 6
const STEPS = 512
const SECONDS = 5
const STEP_MS = 15 // (SECONDS * 1000) / STEPS

const FRAG = `
precision highp float;
varying vec2 vUV;
uniform sampler2D bins; // 512 (time) x 6 (bands), newest on the right
uniform float time;

vec3 palette(int i) {
  if (i == 0) return vec3(0.18, 0.20, 0.45); // deep blue
  if (i == 1) return vec3(0.24, 0.20, 0.52); // indigo
  if (i == 2) return vec3(0.32, 0.24, 0.58); // violet
  if (i == 3) return vec3(0.22, 0.30, 0.60); // blue
  if (i == 4) return vec3(0.40, 0.28, 0.62); // purple
  return vec3(0.20, 0.34, 0.58);             // steel blue
}

void main() {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float lvl = texture2D(bins, vec2(1.0, (float(i) + 0.5) / 6.0)).r; // historic energy
    // a slow sine drifting up the screen, amplitude driven by the band energy
    float base = 0.0 + 0.13 * float(i);
    float wave = base + lvl * 0.1 * sin(vUV.x * 9.0 + time * 1.1 + float(i) * 1.7);
    float d = abs(vUV.y - wave);
    float line = smoothstep(0.3, 0.0, d) * (0.35 + lvl); // glow, brighter with energy
    float fill = smoothstep(0.5, 0.0, wave - vUV.y) * 0.12 * lvl; // faint wash below
    col += palette(i) * (line + fill);
  }
  gl_FragColor = vec4(col * 0.65, 1.0); // keep it dark and chill
}
`

export function startVisualiser(canvas: HTMLCanvasElement, analyser: AnalyserNode): () => void {
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: false })
  const scene = new BABYLON.Scene(engine)
  const camera = new BABYLON.FreeCamera('viz-cam', new BABYLON.Vector3(0, 0, -1), scene)

  const bytes = new Uint8Array(analyser.frequencyBinCount)
  const cur = new Uint8Array(BANDS)
  // RGBA history texture: STEPS columns x BANDS rows, value stored in every channel
  const data = new Uint8Array(STEPS * BANDS * 4)
  const tex = BABYLON.RawTexture.CreateRGBATexture(data, STEPS, BANDS, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE)

  BABYLON.Effect.ShadersStore['vizradioPixelShader'] = FRAG
  const pp = new BABYLON.PostProcess('vizradio', 'vizradio', ['time'], ['bins'], 1.0, camera)
  let t = 0
  pp.onApply = (effect: any) => {
    effect.setTexture('bins', tex)
    effect.setFloat('time', t)
  }

  const n = bytes.length

  function sample() {
    analyser.getByteFrequencyData(bytes)
    for (let i = 0; i < BANDS; i++) {
      // log-spaced buckets (energy clumps in the lows) + treble boost so every band shows
      const start = Math.floor(Math.pow(n, i / BANDS))
      const end = Math.max(start + 1, Math.floor(Math.pow(n, (i + 1) / BANDS)))
      let max = 0
      for (let j = start; j < end && j < n; j++) if (bytes[j] > max) max = bytes[j]
      cur[i] = Math.min(255, Math.round(max * (1 + i * 0.5)))
    }
  }

  // scroll every row one column left, append the current reading on the right
  function pushStep() {
    for (let y = 0; y < BANDS; y++) {
      const base = y * STEPS * 4
      data.copyWithin(base, base + 4, base + STEPS * 4)
      const li = base + (STEPS - 1) * 4
      data[li] = data[li + 1] = data[li + 2] = cur[y]
      data[li + 3] = 255
    }
  }

  let acc = 0
  let last = performance.now()
  engine.runRenderLoop(() => {
    const now = performance.now()
    t += engine.getDeltaTime() / 1000
    acc += now - last
    last = now
    sample()

    // Resample FFT every frame
    pushStep()
    tex.update(data)
    scene.render()
  })

  const resize = () => engine.resize()
  window.addEventListener('resize', resize, { passive: true })

  return () => {
    window.removeEventListener('resize', resize)
    engine.stopRenderLoop()
    pp.dispose()
    tex.dispose()
    scene.dispose()
    engine.dispose()
  }
}
