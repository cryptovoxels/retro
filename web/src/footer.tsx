import { Component } from 'preact'
import { Link } from 'preact-router/match'
import { ssrFriendlyWindow } from '../../common/helpers/utils'
import { currentVersion } from '../../common/version'

type Props = {
  className?: string
}

type State = {}

const active = (...args: string[]) => {
  const path = '/' + ssrFriendlyWindow?.location.pathname.split('/')[1]
  return args.indexOf(path) > -1 ? 'active' : ''
}

export default class WebHeader extends Component<Props, State> {
  state: State = {}

  render() {
    return (
      <footer>
        <nav>
          <ul>
            <li>
              <Link href="/conduct">Conduct</Link>
            </li>
            <li>
              <a href="https://discord.gg/3RSCZGr3fr">Discord</a>
            </li>
            <li>
              <a href="https://www.x.com/cryptovoxels">X</a>
            </li>
            <li>
              <Link href="/privacy">Privacy</Link>
            </li>
            <li>
              <Link href="/terms">Terms</Link>
            </li>
            <li>

            </li>
          </ul>
        </nav>

        <p><Link href="https://github.com/cryptovoxels/retro">source</Link></p>
      </footer>
    )
  }
}
