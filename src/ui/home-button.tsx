import Grid from '../grid'
import { route } from 'preact-router'
import { CubeIcon } from '../../web/src/components/icons/icons'

interface Props {
  grid: Grid
  scene: BABYLON.Scene
}

export default function HomeButton(props: Props) {
  const exit = (e: MouseEvent) => {
    if (!location.pathname.endsWith('/play')) return // off theatre: let href="/" go home
    e.preventDefault()
    const id = props.grid?.currentParcel()?.id
    route(id ? `/parcels/${id}` : '/parcels')
  }

  return (
    <a class="home-button" href="/" onClick={exit}>
      <CubeIcon name="v" />
    </a>
  )
}
