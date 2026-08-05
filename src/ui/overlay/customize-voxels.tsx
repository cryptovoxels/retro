import { md5 } from '../../../common/helpers/utils'
import { debounce, uniqBy } from 'lodash'
import { Component } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { blocks, defaultColors } from '../../../common/content/blocks'
import LoadingIcon from '../../../web/src/components/loading-icon'
import { app } from '../../../web/src/state'
import type Parcel from '../../parcel'

const DEFAULT_TILESET = '/textures/atlas-ao.png?voxelscom'
const { setTimeout } = window

const stableHash = md5

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
}

export default class CustomizeVoxels extends Component<Props, State> {
  image: HTMLImageElement | undefined
  dynamicTexture: BABYLON.DynamicTexture | undefined
  dragOverTimer: number | undefined
  controller: AbortController | null = null
  setColor = debounce(
    (index: number, value: string) => {
      const palette = this.palette.slice()
      palette[index] = value

      this.setState({ palette }, () => {
        this.updatePalette()
      })
    },
    100,
    { trailing: true, leading: false },
  )

  constructor(props: Props) {
    super(props)
    this.state = {
      tileset: props.parcel.tileset,
      palette: props.parcel.palette || defaultColors,
      uploading: false,
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
  }

  updatePalette() {
    this.props.parcel.setPalette(this.state.palette)
  }

  updateTileset() {
    this.props.parcel.setTileset(this.state.tileset)
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

    // fetch(`http://localhost:3000/upload/atlas`, {
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
      }

      return (
        <div
          title="Click to replace texture"
          class={this.state.dragOverIndex === index && ('-dragOver' as any)}
          onDrop={(e) => this.onDrop(index, e)}
          onDragOver={(e) => this.dragOver(index, e)}
          onDragLeave={() => this.dragLeave()}
          onDragEnd={() => this.dragEnd()}
          onClick={() => this.uploadTexture(index)}
        >
          {glass ? <img className="tile" src="/images/glass.png" /> : <div className="tile" style={style} />}
        </div>
      )
    })

    const tintEditors = this.palette.map((color, idx) => {
      return <TintColorInput color={color} idx={idx} setColor={(id, color) => this.setColor(id, color)} />
    })

    return (
      <div class="CustomizeVoxels">
        <button title="Click to reset the voxel textures to default" style="float:right" onClick={() => this.resetTileSet()}>
          Reset
        </button>
        <h4>Customize Voxels</h4>
        <small>
          You can add your own images as <strong>voxel textures</strong>. To upload, click on one of the slots below, or just drag and drop.
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
        {app.signedIn && <OtherTextures />}
        <small>
          Click any of the colors below to update <strong>voxel tints</strong>.
        </small>
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

export const TintColorInput = ({ idx, color, setColor }: { idx: number; color: string; setColor: (id: number, col: string) => void }) => {
  return <input className="tint" type="color" onInput={(e) => setColor(idx, e.currentTarget.value)} value={color} />
}

export const OtherTextures = () => {
  const [show, setShow] = useState<boolean>(false)
  const set = useRef<Map<string, string>>(new Map<string, string>())
  const [loading, setLoading] = useState<boolean>(false)
  let controller: AbortController

  async function cutImageUp(ev: any, image: HTMLImageElement, cb: () => void) {
    const numColsToCut = 4
    const numRowsToCut = 4
    const widthOfOnePiece = 256
    const heightOfOnePiece = 256

    const oversize = 64
    const canvas = document.createElement('canvas')
    canvas.style.display = 'none'
    canvas.width = 128
    canvas.height = 128
    const context = canvas.getContext('2d')
    for (let x = 0; x < numColsToCut; ++x) {
      for (let y = 0; y < numRowsToCut; ++y) {
        // clear canvas
        context?.clearRect(0, 0, canvas.width, canvas.height)
        // draw image
        context!.drawImage(image, x * widthOfOnePiece + oversize, y * heightOfOnePiece + oversize, 128, 128, 0, 0, canvas.width, canvas.height)

        // Create a hash of the image data to avoid duplicate textures
        // This is not perfect as it will only be a perfect match, and we'll notice a few similar images
        // TODO: Make this a good 99% check to avoid duplicates
        const url = canvas.toDataURL()
        const hashed = stableHash(url)
        if (!set.current.has(hashed)) {
          set.current.set(hashed, url)
        }
      }
    }
    cb()
  }

  const img = new Image()
  img.crossOrigin = 'Anonymous'
  const loadImage = (href: string) => {
    return new Promise((resolve) => {
      const kill = () => {
        resolve(true)
      }

      img.src = href
      img.onload = (e) => {
        cutImageUp(e, img, kill)
      }
    })
  }

  useEffect(() => {
    if (show) {
      fetchTextures()
    }
  }, [show])

  const fetchTextures = () => {
    controller = new AbortController()

    const signal = controller.signal
    setLoading(true)
    fetch(`${process.env.API}/parcels/resources/${app.state.wallet}.json`, {
      method: 'GET',
      signal,
    })
      .then((r) => r.json())
      .then(async (res: { sucess: boolean; resources: { tileset: string }[] }) => {
        if (res && res.resources) {
          // Get valid tilesets only and remove duplicates
          const resources = uniqBy(
            res.resources.filter((p) => !!p.tileset).filter((p) => !p.tileset.match('/textures/atlas-ao.png')),
            (v) => v.tileset,
          )

          for (const r of resources) {
            await loadImage(process.env.IMG_HOST + r.tileset)
          }
        }
        setLoading(false)
        controller = null!
      })
  }

  const length = set.current.size

  if (!show) {
    return (
      <div className="OtherTextures">
        <span>Replace with a texture from another parcel</span>
        <div className="Center">
          <button onClick={() => setShow(true)}>Click to Load textures</button>
        </div>
      </div>
    )
  }

  return (
    <div className="OtherTextures">
      {!loading && !!length ? <span>We found {set.current.size} textures in your other parcels! You can drag and drop any following images into the slots above:</span> : !loading && !length && <span>No custom textures were found.</span>}
      <div style={{ display: 'flex', overflowX: 'auto', padding: 3 }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'Center', justifyContent: 'space-between', width: '100%' }}>
            <LoadingIcon />
            <small> Searching for textures in your other parcels</small>
          </div>
        )}
        {!loading &&
          !!length &&
          Array.from(set.current.entries()).map(([hash, url]) => {
            return <img className={'other-parcel-texture'} onDragStart={(e) => e.dataTransfer!.setData('text/plain', url)} key={hash} src={url} title={'Drag me into a voxels slot!'} />
          })}
      </div>
    </div>
  )
}

export async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const res: Response = await fetch(dataUrl)
  const blob: Blob = await res.blob()
  return new File([blob], fileName, { type: 'image/png' })
}
