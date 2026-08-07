import { WompWallRecord } from '../../common/messages/feature'
import { Position, Rotation, Scale, EditorProps } from '../../web/src/components/editor'
import { rebindGizmos } from '../tools/gizmos'
import { FeatureEditor, FeatureEditorProps, Toolbar } from '../ui/features'
import { FeatureMetadata, FeatureTemplate } from './_metadata'
import Feature, { Feature2D, FeatureEvent, MeshExtended } from './feature'
import {
  tileIndexFromUv,
  WOMP_WALL_COLS as COLS,
  WOMP_WALL_GAP as GAP,
  WOMP_WALL_HEADER_FRAC as HEADER_FRAC,
  WOMP_WALL_ROWS as ROWS,
  WOMP_WALL_TILES as TILES,
} from './womp-wall-hit'

const TEX_W = 768
const TEX_H = 512
const REFRESH_MS = 60_000

type WallWomp = {
  id: number
  image_url?: string
  image_supplied?: boolean
}

export default class WompWall extends Feature2D<WompWallRecord> {
  static metadata: FeatureMetadata = {
    title: 'Womp wall',
    subtitle: 'recent womps from this parcel',
    type: 'womp-wall',
    image: '/icons/image.png',
  }

  static template: FeatureTemplate = {
    type: 'womp-wall',
    scale: [2, 1.5, 0],
  }

  private tiles: Array<WallWomp | null> = Array(TILES).fill(null)
  private lastPick: BABYLON.PickingInfo | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private dynamicTexture: BABYLON.DynamicTexture | null = null
  private paintGen = 0

  get isInteract() {
    return true
  }

  shouldBeInteractive() {
    return true
  }

  whatIsThis() {
    return <label>Shows recent womps taken on this parcel. One per parcel. Click a tile to open that womp.</label>
  }

  toString() {
    return '[womp-wall]'
  }

  generateDraft() {
    if (this.disposed) return
    if (!(this.mesh instanceof BABYLON.Mesh)) {
      this.mesh = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene) as MeshExtended
      rebindGizmos(this)
    }
    this.mesh.material = Feature.getDraftMaterial(this.scene)
    this.setCommon()
  }

  async generate(): Promise<void> {
    this.generateDraft()
    this.ensureBoard()
    this.addEvents()
    void this.loadAndPaint()
    this.scheduleRefresh()
  }

  private ensureBoard() {
    if (this.disposed) return
    if (!(this.mesh instanceof BABYLON.Mesh)) {
      this.mesh = BABYLON.MeshBuilder.CreatePlane(this.uniqueEntityName('mesh'), { size: 1 }, this.scene) as MeshExtended
      rebindGizmos(this)
    }

    if (!this.dynamicTexture) {
      this.dynamicTexture = new BABYLON.DynamicTexture(this.uniqueEntityName('texture'), { width: TEX_W, height: TEX_H }, this.scene, false)
      this.dynamicTexture.hasAlpha = false
    }

    const material = new BABYLON.StandardMaterial(this.uniqueEntityName('material'), this.scene)
    material.specularColor.set(0, 0, 0)
    material.diffuseColor.set(1, 1, 1)
    material.emissiveColor.set(1, 1, 1)
    material.diffuseTexture = this.dynamicTexture
    material.backFaceCulling = false
    material.zOffset = -1

    const old = this.mesh.material
    this.mesh.material = material
    if (old instanceof BABYLON.StandardMaterial && old !== Feature.draftMaterial && old.getBindedMeshes().length <= 1) {
      old.dispose(false, false)
    }

    this.paintEmpty()
    this.setCommon()
  }

  private paintEmpty() {
    if (!this.dynamicTexture) return
    const ctx = this.dynamicTexture.getContext() as CanvasRenderingContext2D
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, TEX_W, TEX_H)

    const headerH = TEX_H * HEADER_FRAC
    ctx.fillStyle = '#111111'
    ctx.fillRect(0, 0, TEX_W, headerH)
    ctx.fillStyle = '#eeeeee'
    ctx.font = `bold ${Math.floor(headerH * 0.45)}px 'Helvetica Neue', sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('womps', TEX_W / 2, headerH / 2)

    for (let i = 0; i < TILES; i++) {
      const r = cellRect(i)
      ctx.fillStyle = '#2a2a2a'
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }

    this.dynamicTexture.update(false)
  }

  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      if (this.disposed) return
      void this.loadAndPaint()
      this.scheduleRefresh()
    }, REFRESH_MS)
  }

  private async loadAndPaint() {
    const gen = ++this.paintGen
    const parcelId = this.parcel?.id
    if (!parcelId || window.config?.isSpace) {
      this.tiles = Array(TILES).fill(null)
      this.paintEmpty()
      return
    }

    let womps: WallWomp[] = []
    try {
      const api = process.env.API || '/api'
      const res = await fetch(`${api}/womps/at/parcel/${parcelId}.json?limit=${TILES}`, { signal: this.abortController.signal })
      if (!res.ok) return
      const data = await res.json()
      womps = Array.isArray(data?.womps) ? data.womps : []
    } catch {
      return
    }

    if (this.disposed || gen !== this.paintGen) return

    this.tiles = Array(TILES).fill(null)
    for (let i = 0; i < TILES && i < womps.length; i++) {
      const w = womps[i]
      if (!w?.id) continue
      this.tiles[i] = { id: w.id, image_url: w.image_url, image_supplied: w.image_supplied }
    }

    this.paintEmpty()
    if (!this.dynamicTexture) return
    const ctx = this.dynamicTexture.getContext() as CanvasRenderingContext2D

    await Promise.all(
      this.tiles.map(async (w, i) => {
        if (!w) return
        const url = wompSrc(w)
        if (!url) return
        const r = cellRect(i)
        try {
          const img = await fetchImageBitmap(url, this.abortController.signal)
          if (this.disposed || gen !== this.paintGen) {
            img.close()
            return
          }
          ctx.drawImage(img, r.x, r.y, r.w, r.h)
          img.close()
        } catch {
          // skip broken tile
        }
      }),
    )

    if (this.disposed || gen !== this.paintGen || !this.dynamicTexture) return
    this.dynamicTexture.update(false)
  }

  addEvents(mesh?: any) {
    if (this.disposed) return
    const m = mesh || this.mesh
    if (!m) return

    m.cvOnLeftClick = (pickInfo: BABYLON.PickingInfo | null | undefined) => {
      this.lastPick = pickInfo || null
      const point: BABYLON.FloatArray = []
      const normal: BABYLON.FloatArray = []
      if (pickInfo?.pickedPoint) {
        pickInfo.pickedPoint.subtract(this.parcel.transform.position).toArray(point)
        pickInfo.getNormal()?.toArray(normal)
      }
      this.onClick({ point, normal })
    }
  }

  onClick(_event: FeatureEvent) {
    if (!this.mesh || !this.lastPick?.pickedPoint) return
    const inv = BABYLON.Matrix.Invert(this.mesh.getWorldMatrix())
    const local = BABYLON.Vector3.TransformCoordinates(this.lastPick.pickedPoint, inv)
    // plane size 1: x/y in [-0.5, 0.5], y up → u/v 0..1 with v from bottom
    const index = tileIndexFromUv(local.x + 0.5, local.y + 0.5)
    if (index < 0) return
    const womp = this.tiles[index]
    if (!womp?.id) return
    window.ui?.openLink(`/womps/${womp.id}`)
  }

  dispose() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.paintGen++
    // mesh material dispose frees the texture
    this.dynamicTexture = null
    super.dispose()
  }
}

function cellRect(index: number): { x: number; y: number; w: number; h: number } {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  const headerH = TEX_H * HEADER_FRAC
  const gridH = TEX_H - headerH
  const gapX = TEX_W * GAP
  const gapY = TEX_H * GAP
  const cellW = (TEX_W - gapX * (COLS + 1)) / COLS
  const cellH = (gridH - gapY * (ROWS + 1)) / ROWS
  return {
    x: gapX + col * (cellW + gapX),
    y: headerH + gapY + row * (cellH + gapY),
    w: cellW,
    h: cellH,
  }
}

function wompSrc(w: WallWomp): string | null {
  if (w.image_url) return w.image_url
  if (w.image_supplied || w.id) {
    const api = process.env.API || '/api'
    return `${api}/womps/${w.id}.jpg`
  }
  return null
}

async function fetchImageBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal, credentials: 'omit' })
  if (!res.ok) throw new Error('bad image')
  const blob = await res.blob()
  return createImageBitmap(blob)
}

class Editor extends FeatureEditor<WompWall> {
  constructor(props: FeatureEditorProps<WompWall>) {
    super(props)
    this.state = { id: props.feature.description.id }
  }

  render() {
    return (
      <section>
        <Toolbar feature={this.props.feature} scene={this.props.scene} />
        <EditorProps>
          <Position feature={this.props.feature} key={this.props.feature.position.toString()} />
          <Scale feature={this.props.feature} key={this.props.feature.scale.toString()} />
          <Rotation feature={this.props.feature} key={this.props.feature.rotation.toString()} />
          <p style="font-size: 85%; opacity: 0.7;">Shows the 6 most recent womps from this parcel. One wall per parcel.</p>
        </EditorProps>
      </section>
    )
  }
}

WompWall.Editor = Editor
