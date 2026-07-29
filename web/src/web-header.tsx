import { Component, JSX } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useState } from 'preact/hooks'
import { route } from 'preact-router'
import { Link } from 'preact-router/match'
import { isMobileMedia } from '../../common/helpers/detector'
import { ssrFriendlyDocument } from '../../common/helpers/utils'
import { nearestEditableParcel, uiAsideTick } from '../../src/store'
import Toggle from './components/toggle'
import { PanelType } from './components/panel'
import { app, AppEvent } from './state'
import { CubeIcon } from './components/icons/icons'
import VoxelRadio from './components/voxel-radio'
import { getCoords, PANE_PATHS, paneFromPath, withCoords } from './helpers/coords-nav'

type Props = {
  path: string
  coords?: string
}

type State = {
  searchResults: string[]
  snackbarMessage: string
  expanded: boolean
  query: string
}

const getQueryParams = () => (ssrFriendlyDocument ? new URLSearchParams(document.location.search.substring(1)) : null)

const WORLD_LINKS: Array<{ label: string; pane: string; edit?: boolean }> = [
  { label: 'Explore', pane: 'explorer' },
  { label: 'Settings', pane: 'settings' },
  { label: 'Dance', pane: 'emote' },
  { label: 'Add', pane: 'add', edit: true },
  { label: 'Edit', pane: 'edit', edit: true },
  { label: 'Voxels', pane: 'voxels', edit: true },
  { label: 'Bake', pane: 'bake', edit: true },
]

function WorldNav({ href }: { href: (p: string) => string }) {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    nearestEditableParcel.value
    uiAsideTick.value
    bump((n) => n + 1)
  })

  const ui = typeof window !== 'undefined' ? window.ui : undefined
  const canEdit = app.isAdmin() || !!nearestEditableParcel.value?.canEdit
  const current = paneFromPath()

  return (
    <ul class="world-nav">
      {ui?.state.voiceEnabled && (
        <li title="Microphone">
          <div class="voice-toggle">
            <span class={ui.state.voice !== 'live' ? 'active' : ''}>off</span>
            <Toggle checked={ui.state.voice === 'live'} onChange={() => ui.toggleVoice()} />
            <span class={ui.state.voice === 'live' ? 'active' : ''}>on</span>
          </div>
        </li>
      )}
      {ui && !isMobileMedia() && (
        <li>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              ui.engine.enterFullscreen(!ui.state.fullscreen)
            }}
          >
            {ui.state.fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </a>
        </li>
      )}
      {WORLD_LINKS.map(({ label, pane, edit }) => {
        const disabled = !!edit && !canEdit
        const cls = [current === pane ? 'active' : '', disabled ? 'disabled' : ''].filter(Boolean).join(' ') || undefined
        return (
          <li key={pane} class={cls}>
            <Link href={href(PANE_PATHS[pane])}>{label}</Link>
          </li>
        )
      })}
    </ul>
  )
}

export default class WebHeader extends Component<Props, State> {
  state: State = {
    searchResults: [],
    snackbarMessage: '',
    expanded: false,
    query: getQueryParams()?.get('q') ?? '',
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    app.on(AppEvent.ProviderMessage, this.onProviderMessage)
  }

  componentWillUnmount() {
    app.removeListener(AppEvent.Change, this.onAppChange)
    app.removeListener(AppEvent.ProviderMessage, this.onProviderMessage)
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.path !== this.props.path) {
      this.setState({ expanded: false })
    }
  }

  showSnackbar(message: any) {
    this.setState({ snackbarMessage: message })
    setTimeout(() => {
      this.setState({ snackbarMessage: '' })
    }, 5000)
  }

  onAppChange = () => this.forceUpdate()

  onProviderMessage = (message?: string | Error) => app.showSnackbar(message, PanelType.Info)

  onInput = (e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    this.setState({ query: e.currentTarget.value })
  }

  onSubmit = (e: JSX.TargetedEvent<HTMLFormElement, Event>) => {
    e.stopPropagation()
    e.preventDefault()
    this.setState({ expanded: false })
    route(`/search?q=${encodeURIComponent(this.state.query)}`)
  }

  render() {
    const signedIn = app.signedIn
    const coords = this.props.coords || getCoords()
    const href = (p: string) => (coords ? withCoords(p) : p)

    const navLink = (label: string, link: string) => (
      <Link activeClassName="active" href={href(link)}>
        {label}
      </Link>
    )

    return (
      <>
        <header>
          <nav>
            <ul>
              <li class="logo">
                <a href="/">
                  <CubeIcon name="v" />
                </a>
              </li>
              <li>{navLink(signedIn ? 'Profile' : 'Login', '/account')}</li>
              <li>{navLink('Events', '/events')}</li>
              <li>{navLink('Chat', '/chat')}</li>
              {signedIn && <li>{navLink('Log out', '/logout')}</li>}
              <li>{navLink('...', '/menu')}</li>

              <li>
                <div class="header-end">
                  <VoxelRadio />
                  <form action="/search" onSubmit={this.onSubmit}>
                    <input name="q" value={this.state.query} type="search" onInput={this.onInput} placeholder="Search" />
                  </form>
                </div>
              </li>
            </ul>
            <WorldNav href={href} />
          </nav>
        </header>
      </>
    )
  }
}
