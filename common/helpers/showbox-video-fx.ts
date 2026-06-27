// Showbox video effects (prototype). Ports the "sonar sweep" filter from the Voxelator app and wraps
// it in a LiveKit TrackProcessor so the effect is baked into the published camera stream - viewers,
// mirrors, the homepage thumbnail, and the "what your audience sees" preview all get it for free,
// because they just render whatever track is published.
//
// The effect is a pure 2D-canvas pixel pass (no WebGL). It runs on a downscaled processing canvas so
// it stays real-time on desktop; prototype is desktop-only. The sweep is time-driven and modulated by
// the live broadcast audio level (passed in via getAudioLevel) so the visuals react to the music.

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

// precompute a 256-entry luminance -> RGB lookup, exactly like Voxelator.
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

// sonar sweep period range (seconds), from Voxelator's sonarPeriod slider
export const SONAR_PERIOD_MIN = 1.5
export const SONAR_PERIOD_MAX = 6

// Ported from Voxelator's processSonar, with two changes for the in-world prototype:
//  - a dim palette-tinted base so the camera is faintly visible (reads as a hologram, and makes it
//    obvious the feed is live rather than a pure-black "is it broken?" frame);
//  - audio (0..1) widens + brightens the sweep band so it pulses with the music.
// t is seconds, period is sweep seconds.
function drawSonar(src: ImageData, dst: ImageData, lut: Uint8Array, t: number, period: number, audio: number) {
  const px = src.data
  const out = dst.data
  const phase = (t / period) % 1
  const sweep = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
  const sweepLi = (sweep * 255) | 0
  const sR = lut[sweepLi * 3]
  const sG = lut[sweepLi * 3 + 1]
  const sB = lut[sweepLi * 3 + 2]
  const bandWidth = 0.07 + 0.12 * audio
  const gain = 0.7 + 0.6 * audio
  for (let i = 0; i < px.length; i += 4) {
    const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255
    const li = (lum * 255) | 0
    const k3 = li * 3
    // faint hologram base
    let r = lut[k3] * lum * 0.18
    let g = lut[k3 + 1] * lum * 0.18
    let b = lut[k3 + 2] * lum * 0.18
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

// cap the processing resolution so the per-pixel pass stays real-time; the published track is this size.
const PROC_MAX_W = 480

// Structurally implements livekit-client's TrackProcessor<Video> (name/init/restart/destroy/processedTrack)
// without importing the experimental type, so it stays decoupled from the livekit version.
export class SonarVideoProcessor {
  name = 'showbox-sonar'
  processedTrack?: MediaStreamTrack

  private getAudioLevel: () => number
  private period: number
  private lut: Uint8Array = FX_DEFAULT_PALETTE
  private video: HTMLVideoElement | null = null
  private srcCanvas: HTMLCanvasElement | null = null
  private outCanvas: HTMLCanvasElement | null = null
  private srcCtx: CanvasRenderingContext2D | null = null
  private outCtx: CanvasRenderingContext2D | null = null
  private raf: number | null = null
  private stopped = false
  private t0 = 0

  constructor(getAudioLevel: () => number, periodSeconds = 3) {
    this.getAudioLevel = getAudioLevel
    this.period = periodSeconds
  }

  // live controls - safe to call while the effect is running (the loop reads them each frame)
  setPalette(lut: Uint8Array) {
    this.lut = lut
  }
  setPeriod(seconds: number) {
    this.period = Math.max(SONAR_PERIOD_MIN, Math.min(SONAR_PERIOD_MAX, seconds))
  }

  private mountVideo(track: MediaStreamTrack) {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.autoplay = true
    v.setAttribute('playsinline', '')
    // some browsers won't decode an off-DOM <video> reliably; keep it in the DOM but effectively invisible
    Object.assign(v.style, { position: 'fixed', left: '-10px', top: '-10px', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' })
    v.srcObject = new MediaStream([track])
    document.body.appendChild(v)
    void v.play().catch(() => {})
    this.video = v
  }

  async init(opts: { track: MediaStreamTrack }) {
    this.stopped = false
    this.mountVideo(opts.track)

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
    // paint one frame so the published track is opaque immediately, before the first processed frame
    if (this.outCtx) {
      this.outCtx.fillStyle = '#0a0a18'
      this.outCtx.fillRect(0, 0, w, h)
    }
    // set processedTrack synchronously so livekit has a valid track the moment init resolves
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
      this.srcCtx.drawImage(v, 0, 0, w, h)
      const srcData = this.srcCtx.getImageData(0, 0, w, h)
      const dstData = this.outCtx.createImageData(w, h)
      const t = (performance.now() - this.t0) / 1000
      const audio = Math.max(0, Math.min(1, this.getAudioLevel()))
      drawSonar(srcData, dstData, this.lut, t, this.period, audio)
      this.outCtx.putImageData(dstData, 0, 0)
    }
    // requestVideoFrameCallback fires per decoded frame (reliable); fall back to rAF
    const rvfc = (this.video as any)?.requestVideoFrameCallback
    if (rvfc) rvfc.call(this.video, () => this.loop())
    else this.raf = requestAnimationFrame(this.loop)
  }

  // livekit calls this when the underlying camera track changes (device switch / restart)
  async restart(opts: { track: MediaStreamTrack }) {
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
    if (this.video) {
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
