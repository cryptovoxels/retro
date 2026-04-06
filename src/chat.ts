const getTextWidth = (ctx: CanvasRenderingContext2D, text: string) => {
  return ctx.measureText(text).width
}

const WIDTH = 512
const HEIGHT = 256
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
    m.emissiveColor.set(0.7, 0.7, 0.7)
    this.material = m

    this.parent = parent
    this.drawText()
  }

  getContext() {
    return this.texture.getContext() as CanvasRenderingContext2D
  }

  private drawText() {
    const ctx = this.getContext() as CanvasRenderingContext2D
    const WIDTH = 512
    const HEIGHT = 256

    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    // 1. Comic-style font
    ctx.font = "bold 32px 'Comic Sans MS', sans-serif"
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
    ctx.lineWidth = 5
    ctx.strokeStyle = '#000000'
    ctx.fillStyle = '#ffffff'

    ctx.beginPath()
    // Rounded bubble body
    ctx.roundRect(left, top, w, h, 30)
    ctx.fill()
    ctx.stroke()

    // 3. The "Tail" (Pointing down)
    ctx.beginPath()
    ctx.moveTo(WIDTH / 2 + 30, top + h - 4)
    ctx.lineTo(WIDTH / 2, top + h + 40) // Tip of tail
    ctx.lineTo(WIDTH / 2 + 10, top + h - 4)
    ctx.fill()

    // 4. Tail stroke
    ctx.beginPath()
    ctx.moveTo(WIDTH / 2 + 30, top + h)
    ctx.lineTo(WIDTH / 2, top + h + 40) // Tip of tail
    ctx.lineTo(WIDTH / 2 + 10, top + h)
    ctx.stroke()

    ctx.beginPath()

    // Draw text
    ctx.fillStyle = '#000000'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(this.text, WIDTH / 2, h - 10)
    ctx.fill()

    this.texture.update()
  }
}
