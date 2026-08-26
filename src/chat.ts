import { isHate } from './hate'
import { matcher } from './obscenity'
import { DynamicTexture2D, SceneContext, StandardMaterialProps, TransformNode, onBeforeRender } from '@babylonjs/lite'

const getTextWidth = (ctx: CanvasRenderingContext2D, text: string) => {
  return ctx.measureText(text).width
}

const WIDTH = 512
const HEIGHT = 256
const TOTAL_MS = 1500
const TAIL_MS = 500
const FADE_MS = TOTAL_MS - TAIL_MS

export class Bubble extends (Object as any) /* todo(lite): extends BABYLON.Mesh */ {
  private texture: DynamicTexture2D
  private startedAt = 0
  constructor(
    scene: SceneContext,
    parent: TransformNode,
    public readonly text: string,
  ) {
    super('chat', scene)

    // 1. Get the geometry data for a plane
    // We create a temporary mesh just to steal its vertex data
    const vertexData = (undefined as any /* todo(lite): BABYLON.VertexData.CreatePlane({
      width: 2,
      height: 1,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE, // Easier to see while debugging
    }) */)

    // 2. Apply that geometry to 'this' instance
    vertexData.applyToMesh(this)

    this.billboardMode = (undefined as any /* todo(lite): BABYLON.Mesh.BILLBOARDMODE_Y */)

    this.texture = (undefined as any /* todo(lite): new BABYLON.DynamicTexture(
      'chat',
      {
        width: WIDTH,
        height: HEIGHT,
      },
      scene,
    ) */)
    this.texture.hasAlpha = true

    const m = (undefined as any /* todo(lite): new BABYLON.StandardMaterial('chat', scene) */)
    m.diffuseTexture = this.texture
    m.sideOrientation = (undefined as any /* todo(lite): BABYLON.Mesh.DOUBLESIDE */)
    m.useAlphaFromDiffuseTexture = true
    m.emissiveColor.set(0.7, 0.7, 0.7)
    this.material = m

    this.parent = parent
    this.drawText(1)
    this.startAnimation()
  }

  getContext() {
    return this.texture.getContext() as CanvasRenderingContext2D
  }

  private startAnimation() {
    this.startedAt = performance.now()
    const mat = this.material as StandardMaterialProps
    let lastTail = 1
    // mesh-level observable: cleaned up automatically when this mesh disposes
    onBeforeRender(this, () => {
      const elapsed = performance.now() - this.startedAt
      if (elapsed >= TOTAL_MS) {
        this.dispose()
        return
      }
      if (elapsed < TAIL_MS) {
        const tail = 1 - elapsed / TAIL_MS
        // only redraw when the change is visible; canvas redraws are not free
        if (Math.abs(tail - lastTail) > 0.05) {
          this.drawText(tail)
          lastTail = tail
        }
      } else {
        if (lastTail !== 0) {
          this.drawText(0)
          lastTail = 0
        }
        mat.alpha = 1 - (elapsed - TAIL_MS) / FADE_MS
      }
    })
  }

  private drawText(tailScale: number) {
    const ctx = this.getContext() as CanvasRenderingContext2D
    const WIDTH = 512
    const HEIGHT = 256

    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    // 1. Comic-style font
    ctx.font = "bold 20px 'Source Code Pro', sans-serif"
    ctx.textBaseline = 'top'

    const lines = 1
    const lineHeight = 36

    const w = Math.max(60, getTextWidth(ctx, this.text)) + 40
    const h = lineHeight * lines + 40

    const left = (WIDTH - w) / 2
    const top = 40

    // 2. Draw the Speech Bubble Shape
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 4
    ctx.strokeStyle = '#000000'
    ctx.fillStyle = '#ffffff'

    ctx.beginPath()
    // Rounded bubble body
    ctx.roundRect(left, top, w, h, 10)
    ctx.fill()
    ctx.stroke()

    if (tailScale > 0) {
      const tailLen = 40 * tailScale
      // 3. The "Tail" (Pointing down)
      ctx.beginPath()
      ctx.moveTo(WIDTH / 2 + 30, top + h - 4)
      ctx.lineTo(WIDTH / 2, top + h + tailLen)
      ctx.lineTo(WIDTH / 2 + 10, top + h - 4)
      ctx.fill()

      // 4. Tail stroke
      ctx.beginPath()
      ctx.moveTo(WIDTH / 2 + 30, top + h)
      ctx.lineTo(WIDTH / 2, top + h + tailLen)
      ctx.lineTo(WIDTH / 2 + 10, top + h)
      ctx.stroke()
    }

    ctx.beginPath()

    // Draw text, blurring hate / obscene segments
    ctx.fillStyle = '#000000'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const textX = WIDTH / 2 - getTextWidth(ctx, this.text) / 2
    if (isHate(this.text)) {
      ctx.filter = 'blur(3px)'
      ctx.fillText(this.text, textX, h - 10)
      ctx.filter = 'none'
    } else {
      const matches = matcher.getAllMatches(this.text, true)
      let cursor = 0
      for (const m of matches) {
        if (m.startIndex > cursor) {
          ctx.filter = 'none'
          ctx.fillText(this.text.slice(cursor, m.startIndex), textX + getTextWidth(ctx, this.text.slice(0, cursor)), h - 10)
        }
        ctx.filter = 'blur(3px)'
        ctx.fillText(this.text.slice(m.startIndex, m.endIndex + 1), textX + getTextWidth(ctx, this.text.slice(0, m.startIndex)), h - 10)
        cursor = m.endIndex + 1
      }
      ctx.filter = 'none'
      if (cursor < this.text.length) {
        ctx.fillText(this.text.slice(cursor), textX + getTextWidth(ctx, this.text.slice(0, cursor)), h - 10)
      }
    }
    ctx.fill()

    this.texture.update()
  }
}
