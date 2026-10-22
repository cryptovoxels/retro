import { isHate } from './hate'
import { matcher } from './obscenity'
import { chatLines, chatStyle } from './utils'

const getTextWidth = (ctx: CanvasRenderingContext2D, text: string) => {
  return ctx.measureText(text).width
}

const WIDTH = 512
const HEIGHT = 256
const TOTAL_MS = 20000
const FADE_MS = 500

export class Bubble extends BABYLON.Mesh {
  private texture: BABYLON.DynamicTexture
  constructor(
    scene: BABYLON.Scene,
    parent: BABYLON.TransformNode,
    public readonly text: string,
  ) {
    super('chat', scene)

    // 1. Get the geometry data for a plane
    // We create a temporary mesh just to steal its vertex data
    const vertexData = BABYLON.VertexData.CreatePlane({
      width: 2,
      height: 1,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE, // Easier to see while debugging
    })

    // 2. Apply that geometry to 'this' instance
    vertexData.applyToMesh(this)

    this.isPickable = false
    this.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y

    this.texture = new BABYLON.DynamicTexture(
      'chat',
      {
        width: WIDTH,
        height: HEIGHT,
      },
      scene,
    )
    this.texture.hasAlpha = true

    const m = new BABYLON.StandardMaterial('chat', scene)
    m.diffuseTexture = this.texture
    m.sideOrientation = BABYLON.Mesh.DOUBLESIDE
    m.useAlphaFromDiffuseTexture = true
    m.disableLighting = true
    m.emissiveTexture = this.texture
    m.emissiveColor.set(1, 1, 1)
    this.material = m

    this.drawText()
    const startedAt = performance.now()
    const follow = () => {
      const elapsed = performance.now() - startedAt
      if (elapsed >= TOTAL_MS || parent.isDisposed()) {
        this.dispose()
        return
      }
      this.position.copyFrom(parent.getAbsolutePosition())
      this.position.y += 0.75
      m.alpha = Math.min(1, (TOTAL_MS - elapsed) / FADE_MS)
    }
    follow()
    const observer = scene.onBeforeRenderObservable.add(follow)
    this.onDisposeObservable.add(() => {
      scene.onBeforeRenderObservable.remove(observer)
      m.dispose(false, true)
    })
  }

  getContext() {
    return this.texture.getContext() as CanvasRenderingContext2D
  }

  private drawText() {
    const ctx = this.getContext() as CanvasRenderingContext2D
    const WIDTH = 512
    const HEIGHT = 256

    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    const style = chatStyle()
    ctx.font = `20px ${style.font}`
    ctx.textBaseline = 'top'

    const text = this.text.replace(/\s+/g, ' ').trim()
    const lines = chatLines(ctx, text)
    const lineHeight = 36

    const w = Math.max(60, ...lines.map((line) => getTextWidth(ctx, line))) + 32
    const h = lineHeight * lines.length + 24

    const left = (WIDTH - w) / 2
    const top = 40

    // 2. Draw the Speech Bubble Shape
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 4
    ctx.strokeStyle = style.background
    ctx.fillStyle = style.background

    ctx.beginPath()
    // Rounded bubble body
    ctx.roundRect(left, top, w, h, 10)
    ctx.fill()
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(WIDTH / 2 - 8, top + h - 1)
    ctx.lineTo(WIDTH / 2, top + h + 10)
    ctx.lineTo(WIDTH / 2 + 8, top + h - 1)
    ctx.fill()

    ctx.fillStyle = style.color
    ctx.textAlign = 'left'
    const hate = isHate(text)
    const matches = matcher.getAllMatches(text, true)
    let offset = 0
    for (let row = 0; row < lines.length; row++) {
      const line = lines[row]
      const start = text.indexOf(line.replace(/\.\.\.$/, ''), offset)
      let x = left + 16
      for (let i = 0; i < line.length; i++) {
        const index = start < 0 ? offset + i : start + i
        ctx.filter = hate || matches.some((m) => index >= m.startIndex && index <= m.endIndex) ? 'blur(3px)' : 'none'
        const character = String.fromCodePoint(line.codePointAt(i)!)
        ctx.fillText(character, x, top + 12 + row * lineHeight)
        i += character.length - 1
        x = left + 16 + getTextWidth(ctx, line.slice(0, i + 1))
      }
      offset = (start < 0 ? offset : start) + line.length
    }
    ctx.filter = 'none'

    this.texture.update()
  }
}
