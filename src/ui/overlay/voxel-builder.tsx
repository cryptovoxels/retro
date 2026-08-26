import { Component } from 'preact'
import { blocks, defaultColors } from '../../../common/content/blocks'
import UserInterface from '../../user-interface'
import { SelectionMode } from '../../tools/voxel'
import { SceneContext } from '@babylonjs/lite'

const DEFAULT_TILESET = '/textures/atlas-ao.png'

interface Props {
  tileset?: string
  palette?: string[]
  scene: SceneContext
}

interface State {
  palette: string[] | undefined
  tileset: string | undefined
  tintChooser: boolean
  texture: number | undefined
  tint: number | undefined
}

export default class VoxelBuilder extends Component<Props, State> {
  constructor(props: Props) {
    super(props)

    this.state = {
      tileset: props.tileset || undefined,
      palette: props.palette || undefined,
      tintChooser: false,
      texture: this.ui?.voxelTool.texture,
      tint: this.ui?.voxelTool.tint,
    }
  }

  get tilesetUrl() {
    if (typeof this.state.tileset !== 'string') return DEFAULT_TILESET
    return process.env.IMG_HOST + this.state.tileset
  }

  get scene() {
    return this.props.scene
  }

  get ui(): UserInterface | undefined {
    return window.ui
  }

  get controls() {
    return window.connector.controls
  }

  get palette() {
    return this.state.palette || defaultColors
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.tileset !== this.props.tileset) {
      this.setState({ tileset: this.props.tileset })
    }

    if (prevProps.palette !== this.props.palette) {
      this.setState({ palette: this.props.palette })
    }
  }

  activateBuildTool = () => {
    if (!this.ui) {
      return
    }
    this.controls?.enterFirstPerson()
    this.ui.voxelTool.setMode(SelectionMode.Add)
    this.ui.setTool(this.ui.voxelTool)
    this.ui.closeWithPointerLock()
  }
  activatePaintTool = () => {
    if (!this.ui) {
      return
    }
    this.controls?.enterFirstPerson()
    this.ui.voxelTool.setMode(SelectionMode.Paint, { fixedMode: true })
    this.ui.setTool(this.ui.voxelTool)
    this.ui.closeWithPointerLock()
  }
  activateEraseTool = () => {
    if (!this.ui) {
      return
    }
    this.controls?.enterFirstPerson()
    this.ui.voxelTool.setMode(SelectionMode.Remove, { fixedMode: true })
    this.ui.setTool(this.ui.voxelTool)
    this.ui.closeWithPointerLock()
  }

  toggleTintChooser = () => {
    this.setState({ tintChooser: !this.state.tintChooser })
  }

  selectTint(index: number) {
    if (!this.ui) {
      return
    }
    this.ui.voxelTool.tint = index
    this.setState({ tint: index })
  }

  selectTexture(index: number) {
    if (!this.ui) {
      return
    }
    this.ui.voxelTool.texture = index
    this.setState({ texture: index })
  }

  render() {
    const textures = blocks.map((b, index) => {
      const j = index + 1
      const y = Math.floor(j / 4)
      const x = j % 4

      const backgroundPositionX = -x * 96 - 24 + 'px'
      const backgroundPositionY = -y * 96 - 24 + 'px'

      const glass = index === 1

      const url = this.tilesetUrl
      const backgroundImage = `url(${url})`

      const style = {
        backgroundPositionX,
        backgroundPositionY,
        backgroundImage,
        backgroundColor: this.palette[this.state.tint || 0],
      }
      let tip = 'Click to select block. Double click to enter build mode.'
      if (index < 10) {
        tip += ` [or press ${(index + 1) % 10}]`
      }

      return (
        <div title={tip} class={index === this.state.texture && ('-selected' as any)} onClick={() => this.selectTexture(index)} onDblClick={() => this.activateBuildTool()}>
          {glass ? <img src="/images/glass.png" /> : <div style={style} />}
        </div>
      )
    })

    const tints = this.palette.map((background, index) => {
      const style = { background }
      return <button style={style} onClick={() => this.selectTint(index)} />
    })

    const tintStyle = {
      background: this.palette[this.state.tint || 0],
    }

    return (
      <div class="f VoxelBuilder">
        <h4>Blocks</h4>

        <button class="tint" onClick={this.toggleTintChooser}>
          Choose Tint <span style={tintStyle} />
          {this.state.tintChooser && <ul class="tint-chooser">{tints}</ul>}
        </button>

        <small></small>

        <div className="textures">{textures}</div>
        <div className="controls">
          <button title="Activate build Mode [or press B]" class="-build" onClick={this.activateBuildTool}>
            <u>B</u>uild
          </button>
          <button title="Click to activate Paint Mode [Ctrl/Cmd + Click in build mode]" class="-paint" onClick={this.activatePaintTool}>
            Paint
          </button>
          <button title="Click to activate Erase Mode [Shift + Click in build mode]" class="-erase" onClick={this.activateEraseTool}>
            Erase
          </button>
        </div>
      </div>
    )
  }
}
