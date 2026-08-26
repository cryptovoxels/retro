import { Component } from 'preact'
import { SceneContext } from '@babylonjs/lite'

const { setInterval } = window

/*
THIS IS NOT THE FPS COUNTER IN THE TOP LEFT CORNER IN DEBUG MODE.
*/

type Props = {
  scene: SceneContext
}

export default class FPSCounter extends Component<Props, any> {
  interval: number = undefined!

  constructor() {
    super()
    this.state = {
      fps: 0,
    }
  }

  get color() {
    return this.state.fps < 60 ? '#fc1303' : this.state.fps > 60 && this.state.fps < 90 ? '#fc8003' : '#35c206'
  }

  componentDidMount() {
    this.loopGetFPS()
  }

  componentWillUnmount() {
    this.interval && clearInterval(this.interval)
  }

  loopGetFPS() {
    this.interval = setInterval(() => {
      if (this.props.scene.getEngine) {
        this.setState({ fps: this.props.scene.getEngine().getFps().toFixed(0) })
      }
    }, 500)
  }

  render() {
    return <p style={{ color: this.color }}>{this.state.fps + ' '} FPS</p>
  }
}
