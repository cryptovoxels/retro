import Grid from '../grid'
import { CubeIcon } from '../../web/src/components/icons/icons'

interface Props {
  grid: Grid
  scene: BABYLON.Scene
}

export default function HomeButton(props: Props) {
  return (
    <a class="home-button" href="/">
      <CubeIcon name="v" />
    </a>
  )
}
