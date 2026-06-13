export function drawVideoCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, dx: number, dy: number, dw: number, dh: number) {
  const el = src as HTMLVideoElement
  const vw = el.videoWidth || (src as HTMLImageElement).width || 0
  const vh = el.videoHeight || (src as HTMLImageElement).height || 0
  if (!vw || !vh) return
  const scale = Math.max(dw / vw, dh / vh)
  const sw = dw / scale
  const sh = dh / scale
  const sx = (vw - sw) / 2
  const sy = (vh - sh) / 2
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh)
}
