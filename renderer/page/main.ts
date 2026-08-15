// ABOUTME: Playwright page entry. Exposes window.renderVoxThumb(bytesB64, bg, size) -> webp base64.

import { createThumbScene, renderVoxThumb } from '../../common/renderable/vox-thumb'
import type { ThumbScene } from '../../common/renderable/types'

let ctx: ThumbScene | null = null

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  }
  return btoa(s)
}

async function render(bytesB64: string, background: string, size = 512): Promise<string> {
  if (!(globalThis as any).BABYLON) throw new Error('BABYLON missing')
  if (!ctx) {
    const canvas = document.getElementById('c') as HTMLCanvasElement | null
    if (!canvas) throw new Error('no canvas')
    canvas.width = size
    canvas.height = size
    ctx = createThumbScene(canvas)
  }
  const out = await renderVoxThumb(ctx, {
    kind: 'vox',
    bytes: b64ToBuf(bytesB64),
    background,
    size,
  })
  return bufToB64(out.bytes)
}

;(window as any).renderVoxThumb = render
;(window as any).__renderReady = true
