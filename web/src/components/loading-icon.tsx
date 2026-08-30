import { Component } from 'preact'
import { Spinner } from '../spinner'

//
// This loader aint great
// loadingBox works great where it's currently being used.
// TODO: Go back and replace this one everywhere.
//
type Props = {
  size?: number
  className?: string
}

export default class LoadingIcon extends Component<Props, any> {
  render() {
    return <Spinner size={this.props.size} />
  }
}

export function loadingBox(size = 48) {
  return (
    <div class="cube-page">
      <Spinner size={size} />
    </div>
  )
}
