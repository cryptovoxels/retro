// Showbox video effects (prototype). Ports the "sonar sweep" filter from the Voxelator app and wraps
// it in a LiveKit TrackProcessor so the effect is baked into the published camera stream - viewers,
// mirrors, the homepage thumbnail, and the "what your audience sees" preview all get it for free,
// because they just render whatever track is published.
//
// The effect is a pure 2D-canvas pixel pass (no WebGL). It runs on a downscaled processing canvas so
// it stays real-time on desktop; prototype is desktop-only. The sweep is time-driven and modulated by
// the live broadcast audio level (passed in via getAudioLevel) so the visuals react to the music.

type Stop = { at: number; rgb: [number, number, number] }

// "cyber" palette from Voxelator - a hologram cyan -> magenta -> yellow ramp.
const CYBER_STOPS: Stop[] = [
  { at: 0.0, rgb: [4, 4, 30] },
  { at: 0.33, rgb: [40, 200, 255] },
  { at: 0.66, rgb: [255, 60, 200] },
  { at: 1.0, rgb: [255, 240, 80] },
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

const SONAR_LUT = buildLut(CYBER_STOPS)

// Ported from Voxelator's processSonar, with audio reactivity added: `audio` (0..1) widens and
// brightens the sweep band so it pulses with the music. t is seconds, period is sweep seconds.
function drawSonar(src: ImageData, dst: ImageData, lut: Uint8Array, t: number, period: number, audio: number) {
  const px = src.data
  const out = dst.data
  const phase = (t / period) % 1
  const sweep = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
  const sweepLi = (sweep * 255) | 0
  const sR = lut[sweepLi * 3]
  const sG = lut[sweepLi * 3 + 1]
  const sB = lut[sweepLi * 3 + 2]
  // audio breathes the band: wider + brighter on loud passages
  const bandWidth = 0.05 + 0.12 * audio
  const gain = 0.55 + 0.7 * audio
  for (let i = 0; i < px.length; i += 4) {
    const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255
    const dist = Math.abs(lum - sweep)
    if (dist < bandWidth) {
      const k = (1 - dist / bandWidth) * gain
      out[i] = Math.min(255, sR * k)
      out[i + 1] = Math.min(255, sG * k)
      out[i + 2] = Math.min(255, sB * k)
    } else {
      out[i] = 0
      out[i + 1] = 0
      out[i + 2] = 0
    }
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
  private video: HTMLVideoElement | null = null
  private srcCanvas: HTMLCanvasElement | null = null
  private outCanvas: HTMLCanvasElement | null = null
  private srcCtx: CanvasRenderingContext2D | null = null
  private outCtx: CanvasRenderingContext2D | null = null
  private raf: number | null = null
  private t0 = 0

  constructor(getAudioLevel: () => number, periodSeconds = 3) {
    this.getAudioLevel = getAudioLevel
    this.period = periodSeconds
  }

  async init(opts: { track: MediaStreamTrack }) {
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.autoplay = true
    this.video.srcObject = new MediaStream([opts.track])
    await this.video.play().catch(() => {})

    this.srcCanvas = document.createElement('canvas')
    this.outCanvas = document.createElement('canvas')
    // sane default until the first frame gives real dimensions
    this.srcCanvas.width = this.outCanvas.width = PROC_MAX_W
    this.srcCanvas.height = this.outCanvas.height = Math.round((PROC_MAX_W * 9) / 16)
    this.srcCtx = this.srcCanvas.getContext('2d', { willReadFrequently: true })
    this.outCtx = this.outCanvas.getContext('2d')
    this.processedTrack = (this.outCanvas as any).captureStream(30).getVideoTracks()[0]
    this.t0 = performance.now()
    this.loop()
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const v = this.video
    const sc = this.srcCanvas
    const oc = this.outCanvas
    if (!v || !sc || !oc || !this.srcCtx || !this.outCtx || !v.videoWidth) return
    // match the processing canvas to the camera aspect, capped at PROC_MAX_W
    const scale = Math.min(1, PROC_MAX_W / v.videoWidth)
    const w = Math.max(2, Math.round(v.videoWidth * scale))
    const h = Math.max(2, Math.round(v.videoHeight * scale))
    if (sc.width !== w || sc.height !== h) {
      sc.width = oc.width = w
      sc.height = oc.height = h
    }
    this.srcCtx.drawImage(v, 0, 0, w, h)
    const src = this.srcCtx.getImageData(0, 0, w, h)
    const dst = this.outCtx.createImageData(w, h)
    const t = (performance.now() - this.t0) / 1000
    const audio = Math.max(0, Math.min(1, this.getAudioLevel()))
    drawSonar(src, dst, SONAR_LUT, t, this.period, audio)
    this.outCtx.putImageData(dst, 0, 0)
  }

  // livekit calls this when the underlying camera track changes (device switch / restart)
  async restart(opts: { track: MediaStreamTrack }) {
    if (!this.video) return this.init(opts)
    this.video.srcObject = new MediaStream([opts.track])
    await this.video.play().catch(() => {})
  }

  async destroy() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = null
    try {
      this.processedTrack?.stop()
    } catch {}
    if (this.video) {
      try {
        this.video.pause()
        this.video.srcObject = null
      } catch {}
    }
    this.video = null
    this.srcCanvas = this.outCanvas = null
    this.srcCtx = this.outCtx = null
  }
}
