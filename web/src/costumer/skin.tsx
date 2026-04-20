import { Fragment, Component } from 'preact'
import { ColorInput } from '../../src/components/ColorInput'
import { Costume } from '../../../common/messages/costumes'

const SKIN = '' // require('../../../dist/images/uv-map.svg')

class SVG extends Component<{
  svg?: string
}> {
  render() {
    return <div style="display: none" dangerouslySetInnerHTML={{ __html: this.props.svg ?? '' }} />
  }
}

export interface Props {
  skin?: string
  default_color?: string
  setSkin: (skin: string) => void
  costume: Costume
}

export type State = Readonly<{
  defaultColor: string
  svg?: string
  paths: Readonly<Array<string>>
  colors: Readonly<Record<string, string>>
  expand?: boolean
}>

const TRANSPARENT = 'transparent'

export default class Skin extends Component<Props, State> {
  constructor(props: Props) {
    super()

    this.state = {
      paths: [],
      colors: {},
      defaultColor: props.default_color ?? '#f3f3f3',
      svg: props.skin,
    }
  }

  setAllColors = (color: string) => {
    const elements = document.querySelectorAll(`svg path,svg polygon`)
    elements.forEach((e) => e.setAttribute('fill', color))
    this.props.setSkin(this.svgContent)
    this.load()
  }

  setColor = (part: string, color: string): void => {
    const elements = document.querySelectorAll(`svg *[id='${part}']`)
    elements.forEach((e) => e.setAttribute('fill', color))
  }

  /**
   * On a single part change, this function is called
   * (this saves the new color on the Database)
   */
  onPartColorChange = (part: string, color: string) => {
    this.setColor(part, color)
    this.props.setSkin(this.svgContent)
  }

  get svgContent() {
    const e = document.querySelector('svg g')?.parentElement
    if (!e) return ''
    const s = new XMLSerializer().serializeToString(e)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + s
  }

  /**
   * Grabs the parts and sort them alphabetically
   */
  get sortedParts() {
    return Array.from(this.state.paths).sort((a, b) => a.localeCompare(b))
  }

  setStateAsync(state: Partial<State>): Promise<void> {
    return new Promise((resolve) => {
      this.setState(state, resolve)
    })
  }

  UNSAFE_componentWillUpdate(nextProps: Props) {
    if (this.props.costume.id !== nextProps.costume.id) {
      this.setState({ svg: nextProps.skin })
    }
  }

  componentDidMount() {
    this.load()
    if (!this.state.svg) {
      loadDefaultSkin().then((svg) =>
        this.setState({ svg }, () => {
          this.load()
        }),
      )
    }
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (this.props.costume.id !== prevProps.costume.id) {
      this.setState({ colors: {}, svg: this.props.skin }, () => {
        this.load()
      })
    }

    if (this.state.defaultColor !== prevState.defaultColor) {
      // We changed the defaultColor, save it
      this.props.setSkin(this.svgContent)
    }
  }

  getPaths(): Readonly<string[]> {
    const ids = new Set(Array.from(document.querySelectorAll('svg path, svg polygon')).map((p) => p.id))

    return Array.from(ids)
  }

  load() {
    setTimeout(() => {
      const paths = this.getPaths()
      this.setState({ paths }, () => {
        const colors: Record<string, string> = {}
        for (const path of paths) {
          const part = this.getPartElement(path)
          colors[path] = part?.getAttribute('fill') ?? this.state.defaultColor
        }
        this.setState({ colors })
      })
    }, 100)
  }

  getPartElement(id: string): Element | null {
    return document.querySelector(`svg *[id='${id}']`)
  }

  render() {
    const parts = this.sortedParts.map((part) => {
      const fill = this.state.colors[part]

      const transparent = fill === TRANSPARENT

      const setColor = (color: string): void => {
        this.setState({ colors: { ...this.state.colors, [part]: color } })
        this.onPartColorChange(part, color)
      }

      const resetColor = (): void => {
        this.setState({ colors: { ...this.state.colors, [part]: this.state.defaultColor } })
        this.onPartColorChange(part, this.state.defaultColor)
      }

      const toggleTransparency = () => {
        const color = !transparent ? TRANSPARENT : this.state.defaultColor
        setColor(color)
        this.onPartColorChange(part, color)
      }

      return <PartRow key={part} partName={part} transparent={transparent} fillColor={fill} onColorSet={(color) => setColor(color)} onTransparentSet={toggleTransparency} onReset={resetColor} />
    })

    const toggle = (event: Event) => {
      event.preventDefault()
      this.setState((prevState) => ({ expand: !prevState.expand }))
    }

    return (
      <Fragment>
        <div>
          <SVG svg={this.state.svg} />
        </div>

        <ul class="skin-list">
          <li class="everything">
            <ColorInput color={this.state.defaultColor} onColorSelect={(color) => this.setAllColors(color)} id="everything" />
            <label for="everything">Everything</label>
          </li>
          {parts}
        </ul>
      </Fragment>
    )
  }
}

type PartRowProps = {
  partName: string
  transparent: boolean
  fillColor: string
  onColorSet(color: string): void
  onTransparentSet(transparent: boolean): void
  onReset(): void
}

function PartRow({ partName, transparent, fillColor, onColorSet, onTransparentSet }: PartRowProps) {
  const id = partName.split(' ').join('_')
  return (
    <li key={id}>
      <TransparentCheckbox transparent={transparent} onTransparentCheck={onTransparentSet} />
      <ColorInput color={fillColor} disabled={transparent} onColorSelect={onColorSet} id={id} />
      <label for={id}>{partName}</label>
    </li>
  )
}

type TransparentCheckboxProps = {
  transparent: boolean
  onTransparentCheck(transparent: boolean): void
}

function TransparentCheckbox({ transparent, onTransparentCheck }: TransparentCheckboxProps) {
  return (
    <input
      title="Uncheck to make part invisible"
      type="checkbox"
      checked={!transparent}
      onInput={(e) => {
        const checked = (e.target as HTMLInputElement).checked
        return onTransparentCheck(!checked)
      }}
    />
  )
}

function loadDefaultSkin(): Promise<string> {
  // Filthy Hack to get the SVG loading working under webpack.
  // import doesn't work under webpack and require returns a URL;
  // Therefore I rely on XMLHttpRequest
  return new Promise((resolve) => {
    const xmlHTTP = new XMLHttpRequest()

    xmlHTTP.onreadystatechange = (e) => {
      if (!e.currentTarget) return
      const target = e.currentTarget as XMLHttpRequest
      const readyState: number = target['readyState']
      const statusCode: number = target['status']

      if (readyState == 4 && statusCode == 200) {
        // Typical action to be performed when the document is ready:
        resolve(xmlHTTP.responseText)
      }
    }

    xmlHTTP.open('GET', SKIN, true)
    xmlHTTP.send()
  })
}
