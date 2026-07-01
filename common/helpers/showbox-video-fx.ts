// Showbox video effects (prototype). Ports four 2D-canvas filters from the Voxelator app and wraps
// them in a LiveKit TrackProcessor so the chosen effect is baked into the published camera stream -
// viewers, mirrors, the homepage thumbnail, and the "what your audience sees" preview all get it for
// free, because they just render whatever track is published.
//
// Each effect is a pure per-pixel pass (no WebGL), run on a downscaled processing canvas so it stays
// real-time on desktop; prototype is desktop-only. A single normalized slider (0..1) drives the active
// effect's parameter, oriented so right = stronger/faster. Live audio analysis (level + bass/mid/treble
// + a beat-punch envelope, passed in via getAudio) drives each effect's geometry so the video reads as
// a visualizer for the music, not just a video that pulses.

type Stop = { at: number; rgb: [number, number, number] }

// the palettes from Voxelator's dropdown, in the same order.
const PALETTE_DEFS: { key: string; label: string; stops: Stop[] }[] = [
  {
    key: 'iridescent',
    label: 'Iridescent',
    stops: [
      { at: 0.0, rgb: [10, 0, 40] },
      { at: 0.18, rgb: [80, 0, 160] },
      { at: 0.4, rgb: [220, 50, 220] },
      { at: 0.6, rgb: [80, 200, 255] },
      { at: 0.8, rgb: [120, 255, 180] },
      { at: 1.0, rgb: [255, 255, 220] },
    ],
  },
  {
    key: 'synthwave',
    label: 'Synthwave',
    stops: [
      { at: 0.0, rgb: [10, 4, 30] },
      { at: 0.22, rgb: [80, 20, 130] },
      { at: 0.5, rgb: [220, 40, 180] },
      { at: 0.78, rgb: [255, 140, 100] },
      { at: 1.0, rgb: [255, 240, 180] },
    ],
  },
  {
    key: 'plasma',
    label: 'Plasma',
    stops: [
      { at: 0.0, rgb: [12, 0, 60] },
      { at: 0.3, rgb: [120, 20, 180] },
      { at: 0.6, rgb: [255, 80, 100] },
      { at: 0.85, rgb: [255, 200, 60] },
      { at: 1.0, rgb: [255, 255, 220] },
    ],
  },
  {
    key: 'cyber',
    label: 'Cyber',
    stops: [
      { at: 0.0, rgb: [4, 4, 30] },
      { at: 0.33, rgb: [40, 200, 255] },
      { at: 0.66, rgb: [255, 60, 200] },
      { at: 1.0, rgb: [255, 240, 80] },
    ],
  },
  {
    key: 'aurora',
    label: 'Aurora',
    stops: [
      { at: 0.0, rgb: [4, 16, 40] },
      { at: 0.3, rgb: [40, 130, 180] },
      { at: 0.55, rgb: [60, 230, 160] },
      { at: 0.8, rgb: [180, 255, 100] },
      { at: 1.0, rgb: [255, 200, 220] },
    ],
  },
  {
    key: 'vapor',
    label: 'Vapor',
    stops: [
      { at: 0.0, rgb: [16, 0, 40] },
      { at: 0.3, rgb: [200, 100, 200] },
      { at: 0.55, rgb: [120, 220, 255] },
      { at: 0.85, rgb: [255, 200, 240] },
      { at: 1.0, rgb: [255, 255, 240] },
    ],
  },
]

function samplePalette(stops: Stop[], t: number): [number, number, number] {
  if (t <= stops[0].at) return stops[0].rgb
  if (t >= stops[stops.length - 1].at) return stops[stops.length - 1].rgb
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t >= a.at && t <= b.at) {
      const u = (t - a.at) / (b.at - a.at)
      return [a.rgb[0] + (b.rgb[0] - a.rgb[0]) * u, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * u, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * u]
    }
  }
  return stops[stops.length - 1].rgb
}

function buildLut(stops: Stop[]): Uint8Array {
  const lut = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = samplePalette(stops, i / 255)
    lut[i * 3] = r
    lut[i * 3 + 1] = g
    lut[i * 3 + 2] = b
  }
  return lut
}

// public palette list for the dock dropdown: { key, label, lut }
export const FX_PALETTES = PALETTE_DEFS.map((p) => ({ key: p.key, label: p.label, lut: buildLut(p.stops) }))
export const FX_DEFAULT_PALETTE = FX_PALETTES[0].lut // iridescent, Voxelator's default

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// audio analysis passed to every effect: overall level + frequency bands + a beat-punch envelope
// (fast attack / slow decay on the bass, so it snaps on kicks). all 0..1.
export type FxAudio = { level: number; bass: number; mid: number; treble: number; punch: number }

// --- effects (ported from Voxelator). Audio drives GEOMETRY (size/speed/density), not just brightness,
//     so the video reads as a visualizer for the music rather than a video that pulses. ---

// Sonar sweep: a luminance band sweeps over time; BASS shoves the sweep position (it lurches on a kick)
// and the PUNCH flares the band wide + bright. A dim palette base keeps the camera visible.
function drawSonar(src: ImageData, dst: ImageData, lut: Uint8Array, t: number, period: number, a: FxAudio) {
  const px = src.data
  const out = dst.data
  const phase = (t / period) % 1
  let sweep = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
  sweep = Math.min(1, sweep + a.punch * 0.4) // the beat punch jumps the sweep toward the bright end
  const sweepLi = (sweep * 255) | 0
  const sR = lut[sweepLi * 3]
  const sG = lut[sweepLi * 3 + 1]
  const sB = lut[sweepLi * 3 + 2]
  const bandWidth = 0.05 + 0.25 * a.punch + 0.05 * a.level // flares on the beat
  const gain = 0.55 + 0.9 * a.level
  const baseAmt = 0.32 + 0.25 * a.level
  for (let i = 0; i < px.length; i += 4) {
    const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255
    const li = (lum * 255) | 0
    const k3 = li * 3
    let r = lut[k3] * lum * baseAmt
    let g = lut[k3 + 1] * lum * baseAmt
    let b = lut[k3 + 2] * lum * baseAmt
    const dist = Math.abs(lum - sweep)
    if (dist < bandWidth) {
      const k = (1 - dist / bandWidth) * gain
      r += sR * k
      g += sG * k
      b += sB * k
    }
    out[i] = r > 255 ? 255 : r
    out[i + 1] = g > 255 ? 255 : g
    out[i + 2] = b > 255 ? 255 : b
    out[i + 3] = 255
  }
}

// Vector mesh: trace grid distorted by luminance; PUNCH bunches the grid denser on the beat, level brightens.
function drawVectorMesh(src: ImageData, dst: ImageData, lut: Uint8Array, _t: number, spacing: number, a: FxAudio) {
  const W = src.width
  const H = src.height
  const px = src.data
  const out = dst.data
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 0
    out[i + 1] = 0
    out[i + 2] = 0
    out[i + 3] = 255
  }
  const sp = Math.max(4, (spacing * (1 - 0.45 * a.punch)) | 0) // denser on the beat
  const bright = 0.55 + 0.85 * a.level
  const trace = (lum: number, k: number, oi: number) => {
    const nr = out[oi] + lut[k] * bright
    out[oi] = nr > 255 ? 255 : nr
    const ng = out[oi + 1] + lut[k + 1] * bright
    out[oi + 1] = ng > 255 ? 255 : ng
    const nb = out[oi + 2] + lut[k + 2] * bright
    out[oi + 2] = nb > 255 ? 255 : nb
  }
  for (let baseY = sp; baseY < H; baseY += sp) {
    let prevY = -1
    for (let x = 0; x < W; x++) {
      const i = (baseY * W + x) << 2
      const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255
      const dispY = (baseY - (lum - 0.5) * sp * 1.8) | 0
      const cY = dispY < 0 ? 0 : dispY >= H ? H - 1 : dispY
      const k = ((lum * 255) | 0) * 3
      const yA = prevY === -1 ? cY : prevY < cY ? prevY : cY
      const yB = prevY === -1 ? cY : prevY < cY ? cY : prevY
      for (let y = yA; y <= yB; y++) trace(lum, k, (y * W + x) << 2)
      prevY = cY
    }
  }
  for (let baseX = sp; baseX < W; baseX += sp) {
    let prevX = -1
    for (let y = 0; y < H; y++) {
      const i = (y * W + baseX) << 2
      const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255
      const dispX = (baseX + (lum - 0.5) * sp * 1.8) | 0
      const cX = dispX < 0 ? 0 : dispX >= W ? W - 1 : dispX
      const k = ((lum * 255) | 0) * 3
      const xA = prevX === -1 ? cX : prevX < cX ? prevX : cX
      const xB = prevX === -1 ? cX : prevX < cX ? cX : prevX
      for (let x = xA; x <= xB; x++) trace(lum, k, (y * W + x) << 2)
      prevX = cX
    }
  }
}

// Iso contours: quantize luminance into N bands, draw only the band boundaries in palette colors.
// Iso contours: PUNCH blooms extra bands on the beat (more detail floods in); treble sparkles the lines.
let contourBandIdx: Uint8Array | null = null
function drawContour(src: ImageData, dst: ImageData, lut: Uint8Array, _t: number, bands: number, a: FxAudio) {
  const W = src.width
  const H = src.height
  const N = W * H
  if (!contourBandIdx || contourBandIdx.length !== N) contourBandIdx = new Uint8Array(N)
  const idx = contourBandIdx
  const px = src.data
  const out = dst.data
  const b = Math.max(2, (bands + a.punch * 6) | 0) // extra bands bloom on the beat
  const inv = b / 255
  const bright = 0.7 + 0.6 * a.treble
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    let bb = (lum * inv) | 0
    if (bb >= b) bb = b - 1
    idx[j] = bb
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = y * W + x
      const i = j << 2
      const bv = idx[j]
      let boundary = false
      if (x > 0 && idx[j - 1] !== bv) boundary = true
      else if (x < W - 1 && idx[j + 1] !== bv) boundary = true
      else if (y > 0 && idx[j - W] !== bv) boundary = true
      else if (y < H - 1 && idx[j + W] !== bv) boundary = true
      if (boundary) {
        const k3 = ((((bv + 1) / b) * 255) | 0) * 3
        out[i] = Math.min(255, lut[k3] * bright)
        out[i + 1] = Math.min(255, lut[k3 + 1] * bright)
        out[i + 2] = Math.min(255, lut[k3 + 2] * bright)
      } else {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
      }
      out[i + 3] = 255
    }
  }
}

// 8-bit pixelate: PUNCH balloons the cell size on the beat (blocks visibly grow on the kick); treble adds glint.
function drawPixelate(src: ImageData, dst: ImageData, lut: Uint8Array, _t: number, cellSize: number, a: FxAudio) {
  const W = src.width
  const H = src.height
  const px = src.data
  const out = dst.data
  const cs = Math.max(2, (cellSize * (1 + 1.3 * a.punch)) | 0) // blocks balloon on the beat
  const bright = 0.7 + 0.6 * a.level + 0.4 * a.treble
  for (let cy = 0; cy < H; cy += cs) {
    const yEnd = Math.min(H, cy + cs)
    for (let cx = 0; cx < W; cx += cs) {
      const xEnd = Math.min(W, cx + cs)
      let sum = 0
      let cnt = 0
      for (let y = cy; y < yEnd; y += 2) {
        for (let x = cx; x < xEnd; x += 2) {
          const i = (y * W + x) << 2
          sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
          cnt++
        }
      }
      const avg = cnt > 0 ? sum / cnt / 255 : 0
      let r = 0
      let g = 0
      let b = 0
      if (avg >= 0.08) {
        const k = ((avg * 255) | 0) * 3
        r = Math.min(255, lut[k] * avg * bright)
        g = Math.min(255, lut[k + 1] * avg * bright)
        b = Math.min(255, lut[k + 2] * avg * bright)
      }
      for (let y = cy; y < yEnd; y++) {
        for (let x = cx; x < xEnd; x++) {
          const oi = (y * W + x) << 2
          out[oi] = r
          out[oi + 1] = g
          out[oi + 2] = b
          out[oi + 3] = 255
        }
      }
    }
  }
}

// Bayer dither: ordered-threshold dither, palette-graded by luminance; the beat PUNCH lowers the
// threshold so the image floods in on the kick. Param (slider) is the bias: right = darker / sparser dots.
const BAYER8 = new Float32Array([
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29,
  53, 21,
])
for (let i = 0; i < BAYER8.length; i++) BAYER8[i] = (BAYER8[i] + 0.5) / 64
function drawBayer(src: ImageData, dst: ImageData, lut: Uint8Array, _t: number, bias: number, a: FxAudio) {
  const W = src.width
  const H = src.height
  const px = src.data
  const out = dst.data
  const effBias = bias - a.punch * 0.3 // beat floods more pixels in
  const bright = 0.8 + 0.5 * a.level
  for (let y = 0; y < H; y++) {
    const row = (y & 7) << 3
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) << 2
      const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255
      if (lum > BAYER8[row + (x & 7)] + effBias) {
        const k = ((lum * 255) | 0) * 3
        out[i] = Math.min(255, lut[k] * bright)
        out[i + 1] = Math.min(255, lut[k + 1] * bright)
        out[i + 2] = Math.min(255, lut[k + 2] * bright)
      } else {
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
      }
      out[i + 3] = 255
    }
  }
}

// Motion ink: palette-colored trails wherever the image moves; they fade by `decay` (right = longer
// trails). level + punch brighten the ink, so movement on the beat flares.
let motionPrev: Float32Array | null = null
let motionTrail: Float32Array | null = null
function drawMotion(src: ImageData, dst: ImageData, lut: Uint8Array, _t: number, decay: number, a: FxAudio) {
  const N = src.width * src.height
  if (!motionPrev || motionPrev.length !== N) {
    motionPrev = new Float32Array(N)
    motionTrail = new Float32Array(N)
  }
  const prev = motionPrev
  const trail = motionTrail as Float32Array
  const px = src.data
  const out = dst.data
  const threshold = 8
  const bright = 0.7 + 0.6 * a.level + 0.5 * a.punch
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    const diff = lum - prev[j]
    const absDiff = diff < 0 ? -diff : diff
    const newTrail = absDiff > threshold ? Math.min(255, absDiff * 3) : 0
    const decayed = trail[j] * decay
    trail[j] = newTrail > decayed ? newTrail : decayed
    prev[j] = lum
    const u = trail[j] / 255
    const k = ((u * 255) | 0) * 3
    out[i] = Math.min(255, lut[k] * u * bright)
    out[i + 1] = Math.min(255, lut[k + 1] * u * bright)
    out[i + 2] = Math.min(255, lut[k + 2] * u * bright)
    out[i + 3] = 255
  }
}

type FxDraw = (src: ImageData, dst: ImageData, lut: Uint8Array, t: number, param: number, audio: FxAudio) => void

// the effect grid. sliderToParam maps the 0..1 slider so right = stronger/faster for every effect.
export const VIDEO_FX: { key: string; label: string; draw: FxDraw; sliderToParam: (t01: number) => number; defaultSlider: number }[] = [
  { key: 'sonar', label: 'Sonar', draw: drawSonar, sliderToParam: (t) => lerp(6, 1.5, t), defaultSlider: 0.5 }, // right = faster sweep
  { key: 'vmesh', label: 'Vector mesh', draw: drawVectorMesh, sliderToParam: (t) => lerp(40, 6, t), defaultSlider: 0.5 }, // right = denser
  { key: 'contour', label: 'Iso contours', draw: drawContour, sliderToParam: (t) => lerp(3, 14, t), defaultSlider: 0.5 }, // right = more bands
  { key: 'pixelate', label: '8-bit', draw: drawPixelate, sliderToParam: (t) => lerp(6, 32, t), defaultSlider: 0.5 }, // right = chunkier
  { key: 'bayer', label: 'Bayer dither', draw: drawBayer, sliderToParam: (t) => lerp(-0.1, 0.35, t), defaultSlider: 0.5 }, // right = sparser dots
  { key: 'motion', label: 'Motion ink', draw: drawMotion, sliderToParam: (t) => lerp(0.7, 0.97, t), defaultSlider: 0.5 }, // right = longer trails
]

// cap the processing resolution so the per-pixel pass stays real-time; the published track is this size.
const PROC_MAX_W = 480

// Structurally implements livekit-client's TrackProcessor<Video> (name/init/restart/destroy/processedTrack)
// without importing the experimental type, so it stays decoupled from the livekit version.
export class VideoFxProcessor {
  name = 'showbox-fx'
  processedTrack?: MediaStreamTrack

  private getAudio: () => FxAudio
  private effect = VIDEO_FX[0]
  private slider = VIDEO_FX[0].defaultSlider
  private lut: Uint8Array = FX_DEFAULT_PALETTE
  // crossfade: while fading, both the prev and current effect are drawn and blended by `alpha`
  private prevEffect: (typeof VIDEO_FX)[number] | null = null
  private prevSlider = 0.5
  private fadeStart = 0
  private fadeDurMs = 0
  private video: HTMLVideoElement | null = null
  private srcCanvas: HTMLCanvasElement | null = null
  private outCanvas: HTMLCanvasElement | null = null
  private srcCtx: CanvasRenderingContext2D | null = null
  private outCtx: CanvasRenderingContext2D | null = null
  private raf: number | null = null
  private stopped = false
  private ownsVideo = false
  private outImageData: ImageData | null = null
  private fadeA: ImageData | null = null
  private fadeB: ImageData | null = null
  private t0 = 0

  constructor(getAudio: () => FxAudio) {
    this.getAudio = getAudio
  }

  // live controls - safe to call while the effect is running (the loop reads them each frame)
  // fadeMs > 0 crossfades from the current effect to the new one over that many ms.
  setEffect(key: string, fadeMs = 0) {
    const fx = VIDEO_FX.find((f) => f.key === key)
    if (!fx || fx === this.effect) return
    if (fadeMs > 0) {
      this.prevEffect = this.effect
      this.prevSlider = this.slider // capture the outgoing effect's param before the UI sets the new one
      this.fadeStart = performance.now()
      this.fadeDurMs = fadeMs
    } else {
      this.prevEffect = null
    }
    this.effect = fx
  }
  setSlider(t01: number) {
    this.slider = Math.max(0, Math.min(1, t01))
  }
  setPalette(lut: Uint8Array) {
    this.lut = lut
  }

  private mountVideo(track: MediaStreamTrack) {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.autoplay = true
    v.setAttribute('playsinline', '')
    Object.assign(v.style, { position: 'fixed', left: '-10px', top: '-10px', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' })
    v.srcObject = new MediaStream([track])
    document.body.appendChild(v)
    void v.play().catch(() => {})
    this.video = v
  }

  async init(opts: { track: MediaStreamTrack; element?: HTMLMediaElement }) {
    this.stopped = false
    // LiveKit attaches the camera track to a <video> and plays it, then hands it to us as opts.element.
    // Draw from THAT (building our own MediaStream from opts.track produced black/empty frames).
    const el = opts.element instanceof HTMLVideoElement ? opts.element : null
    if (el) {
      el.muted = true
      el.setAttribute('playsinline', '')
      if (!el.isConnected) {
        Object.assign(el.style, { position: 'fixed', left: '-10px', top: '-10px', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' })
        document.body.appendChild(el)
      }
      void el.play().catch(() => {})
      this.video = el
      this.ownsVideo = false
    } else {
      this.mountVideo(opts.track)
      this.ownsVideo = true
    }

    this.srcCanvas = document.createElement('canvas')
    this.outCanvas = document.createElement('canvas')
    const s = (opts.track.getSettings && opts.track.getSettings()) || {}
    const vw = (s.width as number) || 640
    const vh = (s.height as number) || 360
    const scale = Math.min(1, PROC_MAX_W / vw)
    const w = Math.max(2, Math.round(vw * scale))
    const h = Math.max(2, Math.round(vh * scale))
    this.srcCanvas.width = this.outCanvas.width = w
    this.srcCanvas.height = this.outCanvas.height = h
    this.srcCtx = this.srcCanvas.getContext('2d', { willReadFrequently: true })
    this.outCtx = this.outCanvas.getContext('2d')
    if (this.outCtx) {
      this.outCtx.fillStyle = '#000'
      this.outCtx.fillRect(0, 0, w, h)
    }
    this.processedTrack = (this.outCanvas as any).captureStream(30).getVideoTracks()[0]
    this.t0 = performance.now()
    this.loop()
  }

  private loop = () => {
    if (this.stopped) return
    const v = this.video
    const sc = this.srcCanvas
    const oc = this.outCanvas
    if (v && sc && oc && this.srcCtx && this.outCtx && v.videoWidth && v.videoHeight) {
      const scale = Math.min(1, PROC_MAX_W / v.videoWidth)
      const w = Math.max(2, Math.round(v.videoWidth * scale))
      const h = Math.max(2, Math.round(v.videoHeight * scale))
      if (sc.width !== w || sc.height !== h) {
        sc.width = oc.width = w
        sc.height = oc.height = h
      }
      const audio = this.getAudio()
      // global beat pulse: a subtle zoom on the source so the whole frame throbs on the kick (every effect)
      const z = 1 + 0.07 * audio.punch
      const zw = w * z
      const zh = h * z
      this.srcCtx.drawImage(v, (w - zw) / 2, (h - zh) / 2, zw, zh)
      const srcData = this.srcCtx.getImageData(0, 0, w, h)
      if (!this.outImageData || this.outImageData.width !== w || this.outImageData.height !== h) {
        this.outImageData = this.outCtx.createImageData(w, h)
      }
      const dstData = this.outImageData
      const t = (performance.now() - this.t0) / 1000
      const now = performance.now()
      const fading = this.prevEffect && now - this.fadeStart < this.fadeDurMs
      if (fading && this.prevEffect) {
        // draw both effects into scratch buffers and blend by alpha (0 -> 1 over the fade)
        if (!this.fadeA || this.fadeA.width !== w || this.fadeA.height !== h) this.fadeA = this.outCtx.createImageData(w, h)
        if (!this.fadeB || this.fadeB.width !== w || this.fadeB.height !== h) this.fadeB = this.outCtx.createImageData(w, h)
        const alpha = (now - this.fadeStart) / this.fadeDurMs
        this.prevEffect.draw(srcData, this.fadeA, this.lut, t, this.prevEffect.sliderToParam(this.prevSlider), audio)
        this.effect.draw(srcData, this.fadeB, this.lut, t, this.effect.sliderToParam(this.slider), audio)
        const a = this.fadeA.data
        const b = this.fadeB.data
        const o = dstData.data
        const ia = 1 - alpha
        for (let i = 0; i < o.length; i++) o[i] = a[i] * ia + b[i] * alpha
      } else {
        this.prevEffect = null // fade finished (or none) - run just the current effect
        this.effect.draw(srcData, dstData, this.lut, t, this.effect.sliderToParam(this.slider), audio)
      }
      this.outCtx.putImageData(dstData, 0, 0)
    }
    const rvfc = (this.video as any)?.requestVideoFrameCallback
    if (rvfc) rvfc.call(this.video, () => this.loop())
    else this.raf = requestAnimationFrame(this.loop)
  }

  async restart(opts: { track: MediaStreamTrack; element?: HTMLMediaElement }) {
    const el = opts.element instanceof HTMLVideoElement ? opts.element : null
    if (el) {
      el.muted = true
      void el.play().catch(() => {})
      this.video = el
      this.ownsVideo = false
      return
    }
    if (!this.video) return this.init(opts)
    this.video.srcObject = new MediaStream([opts.track])
    void this.video.play().catch(() => {})
  }

  async destroy() {
    this.stopped = true
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = null
    try {
      this.processedTrack?.stop()
    } catch {}
    if (this.video && this.ownsVideo) {
      try {
        this.video.pause()
        this.video.srcObject = null
        this.video.remove()
      } catch {}
    }
    this.video = null
    this.srcCanvas = this.outCanvas = null
    this.srcCtx = this.outCtx = null
  }
}
