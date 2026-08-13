// ABOUTME: Shared Renderable contract for thumbs (vox now; parcel/costume later).

export type RenderableKind = 'vox' // later: parcel | costume | asset

export type Renderable = {
  kind: 'vox'
  bytes: ArrayBuffer
  background: string // #rrggbb
  size: number
}

export type RenderedImage = {
  bytes: ArrayBuffer
  contentType: 'image/webp'
}

export type ThumbScene = {
  engine: BABYLON.Engine
  scene: BABYLON.Scene
  camera: BABYLON.ArcRotateCamera
  canvas: OffscreenCanvas | HTMLCanvasElement
}
