import { debounce } from 'lodash'
import { Component } from 'preact'
import { blocks, defaultColors } from '../../../common/content/blocks'
import type Parcel from '../../parcel'

const DEFAULT_TILESET = '/textures/atlas-ao.png?voxelscom'
const { setTimeout } = window

interface Props {
  parcel: Parcel
  scene: BABYLON.Scene
}

interface State {
  palette: string[] | undefined
  tileset: string | undefined
  dragOverIndex?: number | null
  uploading: boolean
  uploadingText?: string
  reloading?: boolean
  texture: number
  tint: number
}

export default class CustomizeVoxels extends Component<Props, State> {
  image: HTMLImageElement | undefined
  dynamicTexture: BABYLON.DynamicTexture | undefined
  dragOverTimer: number | undefined
  controller: AbortController | null = null
  textureObserver: any = null

  setColor = (index: number, value: string) => {
    const palette = this.palette.slice()
    palette[index] = value
    this.setState({ palette })
    this.props.parcel.applyPaletteLive(palette)
    this.commitPalette()
  }

  commitPalette = debounce(() => {
    this.props.parcel.setPalette(this.state.palette)
  }, 200)

  constructor(props: Props) {
    super(props)
    this.state = {
      tileset: props.parcel.tileset,
      palette: props.parcel.palette || defaultColors,
      uploading: false,
      texture: window.ui?.voxelTool.texture ?? 0,
      tint: window.ui?.voxelTool.tint ?? 0,
    }
  }

  _ctx: CanvasRenderingContext2D | undefined

  get ctx(): CanvasRenderingContext2D | undefined | null {
    if (!this._ctx) {
      const ctx = this.canvas?.getContext('2d')
      if (!ctx) {
        return null
      }
      this._ctx = ctx
    }
    return this._ctx
  }

  get canvas(): HTMLCanvasElement | null {
    return document.querySelector('.CustomizeVoxels canvas') as HTMLCanvasElement | null
  }

  get tileUploader(): HTMLInputElement | null {
    return document.querySelector('.CustomizeVoxels input[type=file].tile-uploader')
  }

  get scene() {
    return this.props.scene
  }

  get tilesetUrl() {
    if (typeof this.state.tileset !== 'string') return DEFAULT_TILESET
    return process.env.IMG_HOST + this.state.tileset
  }

  get palette() {
    if (!this.state.palette) {
      return defaultColors
    }
    if (!Array.isArray(this.state.palette)) {
      return defaultColors
    }
    if (this.state.palette.length !== defaultColors.length) {
      return defaultColors
    }
    return this.state.palette || defaultColors
  }

  setStateAsync(state: Partial<State>): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  componentDidMount() {
    this.loadImage()
    this.textureObserver =
      window.ui?.voxelTool.onCurrentTextureTintUpdate.add(({ texture, tint }) => {
        this.setState({ texture, tint })
      }) ?? null
  }

  componentWillUnmount() {
    this.textureObserver?.remove()
    this.textureObserver = null
  }

  updatePalette() {
    this.props.parcel.setPalette(this.state.palette)
  }

  updateTileset() {
    this.props.parcel.setTileset(this.state.tileset)
  }

  selectTexture(index: number) {
    if (!window.ui) return
    window.ui.voxelTool.texture = index
    this.setState({ texture: index })
  }

  selectTint(index: number) {
    if (!window.ui) return
    window.ui.voxelTool.tint = index
    this.setState({ tint: index })
  }

  onSlotClick(index: number, e: MouseEvent) {
    if (e.shiftKey) {
      this.uploadTexture(index)
      return
    }
    this.selectTexture(index)
  }

  onTintClick(index: number, e: MouseEvent) {
    this.selectTint(index)
    if (e.shiftKey) return
    e.preventDefault()
  }

  uploadTexture(index: number) {
    if (index === 1) {
      alert("Currently you can't replace default glass texture.")
      return
    }
    if (!this.tileUploader) {
      return
    }
    this.tileUploader.onchange = () => {
      if (this.tileUploader?.files && this.tileUploader.files[0] instanceof File) {
        this.replaceTexture(index, this.tileUploader.files[0])
      }
    }
    this.tileUploader.click()
  }

  async resetTileSet() {
    if (confirm('Would you like to reset the voxel textures to default? Any custom textures will be lost.')) {
      await this.setStateAsync({ tileset: undefined, reloading: true })
      this.updateTileset()

      this.props.parcel.resetTileSet()

      setTimeout(() => {
        this.loadImage()
      }, 200)

      setTimeout(() => {
        this.setState({ reloading: false })
      }, 1000)
    }
  }

  async resetPalette() {
    if (confirm('Would you like to reset the tints to default? Any custom tints will be lost.')) {
      await this.setStateAsync({ palette: defaultColors, reloading: true })
      this.updatePalette()

      // I'm not sure why resetting the palette resets the tileset, but i am too scared to change now (stig)
      this.props.parcel.resetTileSet()

      setTimeout(() => {
        this.setState({ reloading: false })
      }, 1000)
    }
  }

  loadImage() {
    this.image = new Image()
    this.image.crossOrigin = 'Anonymous'
    this.image.src = this.tilesetUrl
    this.image.onload = () => {
      if (this.canvas) {
        this.canvas.width = 1024
        this.canvas.height = 1024
      }
      this.image && this.ctx?.drawImage(this.image, 0, 0)
    }

    if (!this.dynamicTexture) {
      this.dynamicTexture = new BABYLON.DynamicTexture('ui/tiles', { width: 1024, height: 1024 }, this.scene, true)
    }
  }

  async replaceTexture(idx: number, file: File | null | undefined) {
    idx++

    await this.setStateAsync({ uploading: true, uploadingText: 'Uploading...' })

    const x = Math.floor(idx % 4) * 256
    const y = (Math.floor(idx / 4) * 256) % 1024

    const image = new Image()

    const reader = new FileReader()

    if (!this.ctx) {
      throw new Error("Can't find CanvasRenderingContext2D")
    }

    // clear out previous texture (just in case new one has alpha channel)
    this.ctx.clearRect(x, y, 256, 256)

    // lol callbacks
    reader.onload = (event) => {
      image.onload = () => {
        // overdraw / bleed
        for (let i = 16; i > 0; i--) {
          this.ctx?.drawImage(image, x + 64 - i, y + 64 - i, 128 + i * 2, 128 + i * 2)
        }

        this.updateTexture()
      }

      image.crossOrigin = 'Anonymous'
      if (event.target && event.target['result']) {
        image.src = event.target['result'] as any
      }
    }

    if (file) {
      reader.readAsDataURL(file)
    } else {
      throw new Error("file can't be read")
    }
  }

  dragOver(index: number, e: DragEvent) {
    clearTimeout(this.dragOverTimer)
    this.setState({ dragOverIndex: index })
    e.preventDefault()
  }

  dragLeave() {
    // stop jank when hovering over "Replace" text using delay
    clearTimeout(this.dragOverTimer)
    this.dragOverTimer = setTimeout(() => {
      this.setState({ dragOverIndex: null })
    }, 200)
  }

  dragEnd() {
    this.setState({ dragOverIndex: null })
  }

  async onDrop(idx: number, e: DragEvent) {
    e.preventDefault()

    if (idx === 1) {
      alert("Currently you can't replace default glass texture.")
      return
    }

    const base64 = e.dataTransfer?.getData('text/plain')
    let file
    if (base64) {
      file = await dataUrlToFile(base64, 'tile-' + idx + '.png')
    } else {
      file = e.dataTransfer?.items[0].getAsFile()
    }
    this.replaceTexture(idx, file)
  }

  updateTexture() {
    if (!this.props.parcel.voxelMesh) {
      console.warn('customize-voxels.updateTexture: Parcel not meshed')
      return
    }

    this.setState({ uploadingText: 'Updating texture...' })
    this.dynamicTexture?.getContext().drawImage(this.canvas, 0, 0)
    this.dynamicTexture?.update(false)

    const m = this.props.parcel.voxelMesh.material as BABYLON.ShaderMaterial
    this.dynamicTexture && m.setTexture('tileMap', this.dynamicTexture)

    this.save()
  }

  save() {
    if (!this.dynamicTexture) {
      throw new Error('cant find dynamic texture')
    }
    this.setState({ uploading: true, uploadingText: 'Saving...' })

    const formData = new FormData()

    ;(this.dynamicTexture.getContext() as CanvasRenderingContext2D).canvas.toBlob(
      (blob) => {
        if (!blob) {
          throw new Error('blob is null')
        }
        formData.append(`atlas`, blob, `atlas.png`)
        this.upload(formData)
      },
      'image/png',
      1,
    )
  }

  upload(formData: FormData) {
    if (this.controller) {
      this.controller.abort('ABORT:uploading')
    }

    this.controller = new AbortController()

    const signal = this.controller.signal

    fetch(`https://img.cryptovoxels.com/node/upload/atlas`, {
      method: 'POST',
      body: formData,
      mode: 'cors',
      signal,
    })
      .then((r) => r.json())
      .then((res) => {
        this.controller = null

        this.setState({
          tileset: res.path,
          dragOverIndex: null,
          uploading: false,
          uploadingText: '',
        })

        this.props.parcel.setTileset(res.path)

        this.forceUpdate()
      })
      .catch((e) => {
        console.log('Error', e)
      })
  }

  render() {
    if (this.state.reloading) {
      return (
        <div class="CustomizeVoxels">
          <p>Please wait...</p>
        </div>
      )
    }

    const tint = this.state.tint || 0
    const images = blocks.map((b, index) => {
      const j = index + 1
      const y = Math.floor(j / 4)
      const x = j % 4

      const backgroundPositionX = -x * 96 - 24 + 'px'
      const backgroundPositionY = -y * 96 - 24 + 'px'

      const glass = index === 1

      const style = {
        backgroundPositionX,
        backgroundPositionY,
        backgroundImage: `url(${this.tilesetUrl})`,
        backgroundColor: this.palette[tint],
      }

      const classes = [index === this.state.texture && 'selected', this.state.dragOverIndex === index && 'dragOver'].filter(Boolean).join(' ')

      return (
        <div
          title="Click to select. Shift-click to upload."
          class={classes}
          onDrop={(e) => this.onDrop(index, e)}
          onDragOver={(e) => this.dragOver(index, e)}
          onDragLeave={() => this.dragLeave()}
          onDragEnd={() => this.dragEnd()}
          onClick={(e) => this.onSlotClick(index, e)}
        >
          {glass ? <img className="tile" src="/images/glass.png" /> : <div className="tile" style={style} />}
        </div>
      )
    })

    const tintEditors = this.palette.map((color, idx) => {
      return (
        <span class={idx === tint ? 'selected' : undefined} title="Click to select. Shift-click to change." onClick={(e) => this.onTintClick(idx, e)}>
          <TintColorInput color={color} idx={idx} setColor={(id, c) => this.setColor(id, c)} onPick={(e) => this.onTintClick(idx, e)} />
        </span>
      )
    })

    return (
      <div class="CustomizeVoxels">
        <button title="Click to reset the voxel textures to default" style="float:right" onClick={() => this.resetTileSet()}>
          Reset
        </button>
        <h4>Voxels</h4>
        <small>
          Click a slot to select. Shift-click or drag-and-drop to upload a <strong>voxel texture</strong>.
        </small>
        <div className="textures">
          <input style="display: none;" type="file" class="tile-uploader" accept="image/*" />
          {images}
        </div>
        {this.state.uploading && (
          <div>
            <div className="loading"></div>
            {this.state.uploadingText}
          </div>
        )}
        <h4>Voxel tints</h4>
        <small>Click to select. Shift-click to change.</small>
        <div className="tints">
          {tintEditors}{' '}
          <button title="Click to reset the tints to default" style="float:right" onClick={() => this.resetPalette()}>
            Reset
          </button>
        </div>
        <canvas className={`block ${this.state.dragOverIndex && 'dragover'}`} style={{ opacity: 0.001, width: 320, height: 320, position: 'absolute', pointerEvents: 'none' }} width={1024} height={1024} />
      </div>
    )
  }
}

export const TintColorInput = ({
  idx,
  color,
  setColor,
  onPick,
}: {
  idx: number
  color: string
  setColor: (id: number, col: string) => void
  onPick?: (e: MouseEvent) => void
}) => {
  return <input className="tint" type="color" onClick={onPick} onInput={(e) => setColor(idx, e.currentTarget.value)} value={color} />
}

export async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const res: Response = await fetch(dataUrl)
  const blob: Blob = await res.blob()
  return new File([blob], fileName, { type: 'image/png' })
}
