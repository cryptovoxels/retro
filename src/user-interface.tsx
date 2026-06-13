import type { Signal } from '@preact/signals'
import { effect } from '@preact/signals'
import { Component, createRef, Fragment, h } from 'preact'
import { route } from 'preact-router'
import { isMobileMedia } from '../common/helpers/detector'
import { exitPointerLock, hasPointerLock, requestPointerLock } from '../common/helpers/ui-helpers'
import { onBeginUpload, onCompleteUpload, onFailUpload } from '../common/helpers/upload-media'
import { shorterWallet } from '../common/helpers/utils'
import { Login } from '../web/src/auth/login'
import { PanelType } from '../web/src/components/panel'
import Snackbar from '../web/src/components/snackbar'
import { app, AppEvent } from '../web/src/state'
import { KeyboardHandler } from './components/keyboard-handler'
import { OnlyMobile, ViewOnCondition } from './components/utils'
import { Animations } from './avatar-animations'
import { EmoteAnimation } from './states'
import Connector, { messageList } from './connector'
import DesktopControls from './controls/desktop/controls'
import { Environment } from './enviroments/environment'
import { createFeature } from './features/create'
import Feature from './features/feature'
import type Grid from './grid'
import type { MinimapSettings } from './minimap'
import Parcel from './parcel'
import { isScratchpad } from './scene-config'
import { onLoadPromise } from './utils/loading-done'
import { selectCurrentOrNearestParcel, selectNearestEditableParcel, selectSelectedFeature, setCheckedFeatures } from './store'
import FeatureTool, { templateFromFeature } from './tools/feature'
import VoxelTool, { SelectionMode, SelectionModeOptions } from './tools/voxel'
import ConnectionStatusUI from './ui/connection-status'
import { CongaJoinHintOverlay, CongaStatusOverlay } from './ui/conga-status'
import { MaterialDebugTab } from './ui/debug/material-debug-tab'
import { OceanDebugTab } from './ui/debug/ocean-debug-tab'
import { PumpDebugTab } from './ui/debug/pump-debug-tab'
import { ExplorerUI, Tab } from './ui/explorer'
import { FeatureContext } from './ui/features/context'
import { FeatureEditor } from './ui/features/misc'
import HomeButton from './ui/home-button'
import { ChatOverlay, chatSettings } from './ui/interact/chat'
import { EmoteOverlay } from './ui/interact/emote'
import { HelpOverlay } from './ui/interact/help'
import { ScratchpadGuide, ScratchpadGuideMini } from './ui/scratchpad-guide'
import { WompOverlay } from './ui/interact/womps'
import MobileButtons from './ui/mobile/buttons'
import OpenLink from './ui/open-link'
import Baking from './ui/overlay/baking'
import { BuildTab } from './ui/overlay/build-tab/build-tab'
import DebugTools from './ui/overlay/debug-tools'
import EditTab from './ui/overlay/edit-tab'
import Inspector from './ui/overlay/inspector'
import ParcelInfoTab from './ui/overlay/parcel-info'
import ToolBelt from './ui/overlay/tool-belt'
import ParcelSnapshots from './ui/parcel-snapshots'
import { SettingsUI } from './ui/settings'
import TakeWomp from './ui/take-womp'
import UploadStatusUI from './ui/upload-status'

const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const

const Location = (props: { scene: BABYLON.Scene; signedIn: any }) => {
  const currentOrNearestParcel = selectCurrentOrNearestParcel()
  if (!currentOrNearestParcel) {
    return null
  }

  const owner = currentOrNearestParcel.owner ? shorterWallet(currentOrNearestParcel.owner) : 'nobody'

  const link = `/parcels/${currentOrNearestParcel.id}`

  return (
    <a key={currentOrNearestParcel.id} class="address" href={link} target="_top">
      {currentOrNearestParcel.name || currentOrNearestParcel.address}
    </a>
  )
}

export enum Mode {
  Default,
  Voxels,
  Features,
  Parcel,
  Avatar,
}

export type UIPanes = 'add' | 'edit' | 'inspector' | 'feature-editor' | 'info' | 'debugTool' | 'nfts' | 'chat' | 'emote' | 'settings' | 'womp' | 'help' | 'explorer' | 'login' | 'parcelSnapshots' | 'bake'

export interface Tool {
  activate: () => void
  deactivate: () => void
  enabled: Signal<boolean>
}

export interface UserInterfaceProps {
  scene: BABYLON.Scene
  parent: BABYLON.TransformNode
  canvas: HTMLCanvasElement
  grid: Grid
  connector: Connector
  environment: Environment
  enabled: boolean
  minimapSettings: MinimapSettings
}

type UserInterfaceState = {
  enabled: boolean
  /**
   * Current open pane in the UI
   */
  pane?: UIPanes
  hover?: string
  signedIn: boolean
  wallet: string | null
  unreadCount: number
  fullscreen: boolean
  settingsVisible?: boolean
  personaVisible?: boolean
  currentOrNearestParcel: Parcel | null
  signInVisible?: boolean
  userName?: string
  parcelId?: number
  canEdit?: boolean
  editor?: FeatureEditor
  feature?: Feature
  active: boolean
  /** Shown next to minimap expand; same source as Explore radar */
  onlineCount: number
  scratchpadGuideOpen?: boolean
  scratchpadGuideMini?: boolean
  scratchpadGuideRestart?: boolean
  scratchpadGuideKey?: number
  chatEnabled: boolean
}

export default class UserInterface extends Component<UserInterfaceProps, UserInterfaceState> {
  canvas: HTMLCanvasElement
  visible: boolean
  mode: Mode
  connector: Connector
  grid: Grid
  environment: Environment

  // sub tools
  activeTool: Tool | null = null
  voxelTool: VoxelTool
  featureTool: FeatureTool
  defaultTool: Tool | null
  keyboardHandler: KeyboardHandler = undefined!

  //Overlay
  uploadStatusRef = createRef<UploadStatusUI>()

  /**
   * Only used for setting initial tab of the explorer; default undefined
   * We use a ref here to avoid re-renders
   */
  explorerPaneInitialTab = createRef<Tab | undefined>()
  presenceEs: EventSource | null = null
  presenceUuids = new Set<string>()
  chatLastReadAt = Date.now()
  chatListDispose?: () => void

  constructor(props: UserInterfaceProps) {
    super(props)

    this.visible = false
    this.mode = Mode.Default
    this.canvas = props.canvas
    this.connector = props.connector
    this.grid = props.grid
    this.environment = props.environment

    this.voxelTool = new VoxelTool(this.props.scene, props.parent, props.grid, this.connector.controls, props.connector)
    this.featureTool = new FeatureTool(this.props.scene, props.parent, props.grid, this.connector.controls, props.connector, createFeature)
    this.defaultTool = null
    window.ui = this

    // this.setTool(this.defaultTool)

    this.addKeyboardHandlers()

    this.state = {
      enabled: props.enabled,
      signedIn: app?.signedIn ?? false,
      wallet: app?.state.wallet ?? null,
      unreadCount: app?.state.unreadMailCount ?? 0,
      fullscreen: false,
      currentOrNearestParcel: null,
      active: false,
      onlineCount: 0,
      chatEnabled: chatSettings.enabled,
    }

    if (window.config.isOrbit) {
      return
    }
  }

  get engine() {
    return this.props.scene.getEngine()
  }

  onAppChange = () => {
    const { signedIn, state } = app

    this.setState({
      signedIn,
      userName: window.user.name,
      wallet: state.wallet,
      unreadCount: state.unreadMailCount,
    })

    if (signedIn && this.state.pane === 'login') {
      this.setState({ pane: undefined, active: false })
    }
  }

  refreshFullscreen = () => {
    this.setState({ fullscreen: !!document.fullscreenElement })
  }

  openEditor(editor: FeatureEditor, feature: Feature) {
    this.setState({ feature, editor: editor, currentOrNearestParcel: feature?.parcel, pane: 'feature-editor' })
    exitPointerLock()
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    document.addEventListener('fullscreenchange', this.refreshFullscreen)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    if (isMobileMedia()) {
      this.canvas.addEventListener('touchstart', (e) => {
        this.hide()
      })
    }

    // setInterval(this.updateCanEdit.bind(this), 1000)

    if (this.props.minimapSettings.enabled && !window.config.isOrbit && !window.config.isSpace) {
      this.presenceEs = new EventSource('/api/users/live')
      this.presenceEs.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'snapshot') {
            this.presenceUuids.clear()
            for (const u of msg.users ?? []) this.presenceUuids.add(u.uuid)
          } else if (msg.type === 'move') {
            this.presenceUuids.add(msg.uuid)
          } else if (msg.type === 'leave') {
            this.presenceUuids.delete(msg.uuid)
          } else return
          const n = this.presenceUuids.size
          if (n !== this.state.onlineCount) this.setState({ onlineCount: n })
        } catch {}
      }
    }

    onLoadPromise.then(() => {
      if (!isScratchpad() || isMobileMedia()) return
      this.setState({ scratchpadGuideOpen: true, scratchpadGuideMini: false, scratchpadGuideRestart: false })
    })

    chatSettings.addEventListener('changed', this.onChatSettingsChange)

    this.chatListDispose = effect(() => {
      messageList.value
      this.forceUpdate()
    })
  }

  componentDidUpdate(_prevProps: UserInterfaceProps, prevState: UserInterfaceState) {
    if (!prevState.active && this.state.active) {
      this.chatLastReadAt = Date.now()
    }
  }

  onChatSettingsChange = () => {
    this.setState({ chatEnabled: chatSettings.enabled })
  }

  enterScratchpadGuideMini = () => {
    exitPointerLock()
    this.setState({ pane: 'add', active: true, scratchpadGuideMini: true })
  }

  celebrateScratchpadGuideComplete = () => {
    exitPointerLock()
    this.connector.emote('🔥')
    this.connector.persona.popState(this.connector.controls)
    this.connector.persona.setState({ state: new EmoteAnimation(Animations.Dance) }, this.connector.controls)
    this.setState({ scratchpadGuideOpen: false, scratchpadGuideMini: false, scratchpadGuideRestart: true })
  }

  restartScratchpadGuide = () => {
    this.setState({
      scratchpadGuideMini: false,
      scratchpadGuideKey: (this.state.scratchpadGuideKey || 0) + 1,
      pane: undefined,
      active: false,
    })
  }

  openScratchpadGuide = () => {
    this.setState({
      scratchpadGuideOpen: true,
      scratchpadGuideMini: false,
      scratchpadGuideRestart: false,
      scratchpadGuideKey: (this.state.scratchpadGuideKey || 0) + 1,
      pane: undefined,
      active: false,
    })
  }

  updateCanEdit = () => {}

  componentWillUnmount() {
    this.presenceEs?.close()
    this.presenceEs = null
    app.removeListener(AppEvent.Change, this.onAppChange)
    document.removeEventListener('fullscreenchange', this.refreshFullscreen)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    chatSettings.removeEventListener('changed', this.onChatSettingsChange)
    this.chatListDispose?.()
  }

  onPointerLockChange = () => {
    if (document.pointerLockElement) {
      // close overlays on pointer lock
      this.setState({ pane: undefined, active: false })
    }
  }

  closeWithPointerLock() {
    this.hide()
    requestPointerLock()
  }

  get camera(): BABYLON.UniversalCamera {
    return this.props.scene.activeCamera as BABYLON.UniversalCamera
  }

  refocus() {
    requestPointerLock()

    this.setState({ active: false, pane: undefined })
  }

  disable() {
    this.setState({ enabled: false })
  }

  toggleRealism() {
    const g = window.graphic.getSettings()
    g.realisticLighting = !g.realisticLighting
    window.graphic.setSettings(g)
  }

  addKeyboardHandlers() {
    // TODO: handle babylon input selected

    if (this.keyboardHandler) this.keyboardHandler.dispose()

    // keyboard handler is watching for all events on document
    // (excludes events fired from input elements and repeat events by held keys)
    this.keyboardHandler = new KeyboardHandler(this.props.scene, {
      keyDown: [
        { key: '!', handleEvent: () => {} },
        { code: 'KeyE', handleEvent: () => this.editFeatureIfHasLock() },
        { code: 'KeyX', handleEvent: () => this.deleteFeature() },
        { code: 'KeyM', handleEvent: () => this.editFeatureThenMove() },
        { code: 'KeyR', handleEvent: () => this.toggleRealism() },
        { code: 'KeyP', handleEvent: () => this.takeWomp(this.props.scene) },
        { code: 'KeyI', handleEvent: () => this.activateInspectorIfHasLock() },
        { code: 'KeyF', handleEvent: () => this.connector.controls.toggleFlying() },
        { code: 'KeyC', handleEvent: () => this.connector.controls.togglePerspective() },
        { code: 'KeyB', handleEvent: () => this.toggleVoxelTool() },
        { code: 'KeyG', handleEvent: () => this.setPane('emote') },
        { code: 'KeyZ', handleEvent: () => this.connector.controls.toggleZoom() },
        { code: 'Enter', handleEvent: this.focusChat },
        { code: 'Escape', handleEvent: () => this.onEscape() },
        {
          code: 'Tab',
          handleEvent: (e) => {
            if (isScratchpad() && this.state.scratchpadGuideOpen) {
              e.preventDefault()
              this.setPane('add')
              return
            }

            if (!this.state.active) {
              this.setPane('add')
              return
            }

            if (document.activeElement instanceof HTMLInputElement) {
              return
            } else if (document.activeElement?.closest('.UserInterface')) {
              // ignore tab if inside the nav
              return
            }
          },
        },
      ],
      keyUp: [],
    })

    NUMBER_KEYS.forEach((key, index) => {
      this.keyboardHandler.addKeyDown({
        key,
        handleEvent: () => this.activateVoxelTool(SelectionMode.Add, { texture: index }),
      })
    })
  }

  setPane(pane: UIPanes) {
    if (isScratchpad() && this.state.scratchpadGuideOpen && pane === 'add') {
      this.enterScratchpadGuideMini()
      return
    }

    // Regression from b0da1ac (Ben, May 20): `if (this.state.active) return` made
    // sidebar nav dead on load (active started true) and blocked switching panes.
    if (this.state.pane === pane && this.state.active) {
      this.closeInteractOverlay()
      return
    }

    this.setState({ pane: pane, active: true })

    exitPointerLock()
  }

  activateVoxelTool(mode?: SelectionMode, options?: SelectionModeOptions) {
    if (!this.grid.nearestEditableParcel()) return
    this.setFirstPersonPerspective()
    if (this.connector.controls instanceof DesktopControls && !hasPointerLock()) {
      this.connector.controls.requestPointerLock()
    }
    this.voxelTool.setMode(mode || SelectionMode.Add, options)
    this.setTool(this.voxelTool)
    this.hide()
  }

  toggleVoxelTool() {
    if (this.activeTool !== this.voxelTool) {
      if (!this.grid.nearestEditableParcel()) return
      this.setFirstPersonPerspective()
      this.activateVoxelTool()
    } else {
      this.deactivateToolsAndUnHighlightSelection()
    }
  }

  takeWomp(scene: BABYLON.Scene) {
    if (!app.signedIn) return
    const engine = scene.getEngine()
    TakeWomp.Capture(engine, scene, this.props.minimapSettings)
  }

  closeInteractOverlay() {
    this.setState({ pane: undefined, active: false })
  }

  // the one ESC: leave fullscreen/theatre. two-step -- a locked pointer eats the
  // first ESC (browser releases it), the next ESC exits /play back to the parcel.
  onEscape() {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    if (document.pointerLockElement) return
    if (!location.pathname.endsWith('/play')) return
    const id = this.grid?.currentParcel()?.id
    const coords = new URLSearchParams(location.search).get('coords') || ''
    route(id ? `/parcels/${id}?coords=${coords}` : '/parcels')
  }

  focusChat = (e: KeyboardEvent) => {
    if (!chatSettings.enabled) return

    exitPointerLock()

    const input = document.querySelector('main.chat input') as HTMLInputElement

    if (!input) {
      return
    }

    if (document.activeElement === input) {
      // input.blur()
    } else {
      setTimeout(() => {
        input.focus()
      })
    }
  }

  setTool(tool: Tool | null) {
    this.setState({ pane: undefined, active: false })

    if ((this.activeTool && !this.activeTool.enabled.value) || this.activeTool !== tool) {
      if (this.activeTool) {
        this.activeTool.deactivate()
        this.activeTool = null
      }
      if (tool) {
        tool.activate()
        this.activeTool = tool
      }
    }
  }

  deactivateTools() {
    this.setTool(this.defaultTool)
  }

  deactivateToolsAndUnHighlightSelection() {
    setCheckedFeatures([])

    this.featureTool.unHighlight()
    this.setTool(this.defaultTool)
  }

  activateInspectorIfHasLock() {
    // Inspector only works in pointerlock mode
    if (!hasPointerLock()) {
      return
    }

    this.setFirstPersonPerspective()
    this.featureTool.setMode('inspect')
    this.setTool(this.featureTool)
  }

  setFirstPersonPerspective() {
    if (!this.connector.controls.firstPersonView) {
      this.connector.controls.togglePerspective()
    }
  }

  hide() {
    this.setState({ pane: undefined, active: false })
  }

  highlightFeature(feature: Feature) {
    this.setFirstPersonPerspective()
    this.featureTool.setMode('edit')
    this.setTool(this.featureTool)
    this.featureTool.highlightFeature(feature)
    this.featureTool.nextMode = null
  }

  deleteFeature() {
    const feature = this.featureTool?.selection?.feature as Feature | undefined
    if (!feature?.parcel?.canEdit) return

    feature.delete()
    this.featureTool.unHighlight()
    this.hide()
  }

  editFeatureIfHasLock(): void {
    if (!this.grid.nearestEditableParcel()) return
    if (hasPointerLock()) {
      this.editFeature()
    }
  }

  editFeature(feature?: Feature): void {
    if (!this.grid.nearestEditableParcel()) return

    this.setFirstPersonPerspective()
    this.featureTool.setMode('edit')
    this.setTool(this.featureTool)
    this.featureTool.nextMode = null

    if (feature) {
      this.featureTool.highlightFeature(feature)
      this.featureTool.editFeature(feature)
    } else {
      this.hide()
    }
  }

  editFeatureThenMove() {
    if (!this.grid.nearestEditableParcel()) return

    this.setFirstPersonPerspective()
    this.featureTool.setMode('edit')
    this.featureTool.nextMode = 'move'
    this.setTool(this.featureTool)
    this.hide()
  }

  editFeatureThenCopy() {
    if (!this.grid.nearestEditableParcel()) return

    this.setFirstPersonPerspective()
    this.featureTool.setMode('edit')
    this.setTool(this.featureTool)
    this.featureTool.nextMode = 'copy'
    this.hide()
  }

  copyFeature(feature: Feature) {
    const p = this.grid.nearestEditableParcel()
    if (!p) {
      app.showSnackbar(`Not in a parcel`, PanelType.Danger)
      return
    }
    // Checks the budget limit for all features inside the feature (and group if it's a group)
    const budgetCheck = p.budget.hasBudgetForFeature(feature)

    if (!budgetCheck.pass) {
      // Show all the feature types that reached limit
      const failedTypes = budgetCheck.types.filter((t) => !t.pass).map((t) => t.type)
      app.showSnackbar(`Limit reached for ${budgetCheck.types.length > 1 ? failedTypes.join(', ') : 'this feature'}.`, PanelType.Danger)
      return
    }

    this.setFirstPersonPerspective()
    this.featureTool.setModeCopy(feature)
    this.setTool(this.featureTool)
    this.hide()
  }

  moveFeature(feature: Feature) {
    this.setFirstPersonPerspective()
    this.featureTool.setModeMove(feature)
    this.setTool(this.featureTool)
    this.hide()
  }

  showExplorerMap() {
    // temporarily set the initial tab to map
    this.explorerPaneInitialTab.current = 'map'
    this.setState({ pane: 'explorer', active: true })
    setTimeout(() => {
      // reset to undefined after opening (next tick because setState is async)
      this.explorerPaneInitialTab.current = undefined
    })
  }

  showExplorerOnline() {
    this.explorerPaneInitialTab.current = 'users'
    this.setState({ pane: 'explorer', active: true })
    setTimeout(() => {
      this.explorerPaneInitialTab.current = undefined
    })
  }

  openLink(url: string) {
    if (this.visible) {
      // suppress
      return
    }

    if (url.startsWith('/play') && url.match('coords')) {
      // This is to catch the case where the link is an in-world link but with no domain name.
      // Why? because we already catch inWorldLinks; but some links don't have a domain name and get sent to this method.

      const params = new URLSearchParams(url.split('?')[1])
      // Conserve history by using href=
      window.location.href = `/play?coords=${params.get('coords')}`
      return
    }

    if (url.startsWith('/spaces') && url.match('/play') && url.match('coords')) {
      // Same as above, but this is to catch a link to a Space
      const params = new URLSearchParams(url.split('?')[1])
      const spaceId = url.split('/')[2]
      // Conserve history by using href=
      window.location.href = `/spaces/${spaceId}/play?coords=${params.get('coords')}`
      return
    }

    OpenLink(url)
  }

  showNotificationBanner(message: string, duration = 5000, onClick?: () => void) {
    // ideally we would use a dedicated noitification banner component, but for now we'll use the snackbar
    return Snackbar.show(message, PanelType.Info, duration, onClick)
  }

  enable() {
    this.setState({ enabled: true })
  }

  onLogout = () => {
    window.location.href = '/logout'
  }

  render() {
    if (!this.state.enabled) {
      return <Fragment />
    }

    const onClick = (p: UIPanes) => (e: any) => {
      e.preventDefault()
      this.setPane(p)
    }

    const nearestEditableParcel = selectNearestEditableParcel() ?? null
    const currentOrNearestParcel = selectCurrentOrNearestParcel() ?? null
    const baking = false
    const mintable = app.isAdmin() && nearestEditableParcel?.needsMint
    const selectedFeature = selectSelectedFeature()

    let pane
    switch (this.state.hover || this.state.pane) {
      case 'add':
        pane = <BuildTab parcel={nearestEditableParcel || undefined} scene={this.props.scene} />
        break
      case 'edit':
        pane = <EditTab parcel={nearestEditableParcel} scene={this.props.scene} />
        break
      case 'parcelSnapshots':
        pane = <ParcelSnapshots parcel={nearestEditableParcel || undefined} scene={this.props.scene} />
        break
      case 'inspector':
        pane = <Inspector />
        break
      case 'login':
        pane = <Login />
        break
      case 'feature-editor':
        // pane = <FeatureEditor feature={this.state.feature!} parcel={currentOrNearestParcel!} scene={this.props.scene} />
        const Component = this.state.editor as any

        pane = (
          <FeatureContext.Provider value={{ templateFromFeature }}>
            <Fragment key={this.state.feature?.uuid}>
              {h(Component, {
                feature: this.state.feature,
                parcel: currentOrNearestParcel,
                scene: this.props.scene,
              })}
            </Fragment>
          </FeatureContext.Provider>
        )

        break
      case 'info':
        pane = <ParcelInfoTab parcel={currentOrNearestParcel} scene={this.props.scene} />
        break
      case 'debugTool':
        pane = <DebugTools parcel={currentOrNearestParcel} scene={this.props.scene} environment={this.props.environment} />
        break
      case 'chat':
        pane = <ChatOverlay scene={this.props.scene} />
        break
      case 'emote':
        pane = <EmoteOverlay />
        break
      case 'settings':
        pane = <SettingsUI scene={this.props.scene} minimapSettings={this.props.minimapSettings} />
        break
      case 'womp':
        pane = <WompOverlay scene={this.props.scene} minimapSettings={this.props.minimapSettings} />
        break
      case 'help':
        pane = <HelpOverlay scene={this.props.scene} onShowScratchpadGuide={isScratchpad() ? this.openScratchpadGuide : undefined} />
        break
      case 'explorer':
        pane = <ExplorerUI scene={this.props.scene} initialTab={this.explorerPaneInitialTab.current!} />
        break
      case 'bake':
        pane = <Baking parcel={nearestEditableParcel!} />
        break
    }

    const onHover = (pane: string) => (e: any) => {
      // e.preventDefault()
      // this.setState({ hover: pane })
    }

    const onBlur = (e: any) => {
      e.preventDefault()
      this.setState({ hover: undefined })
    }

    const classes = `UserInterface parent-overlay toolbar-div`
    const canEdit = app.isAdmin() || (nearestEditableParcel ? nearestEditableParcel.canEdit : false)

    const active = (pane: string, disabled?: boolean) => (this.state.pane === pane ? 'active' : disabled ? 'disabled' : '')

    const unreadChat = this.state.chatEnabled && !this.state.active ? messageList.value.some((m) => m.timestamp > this.chatLastReadAt) : false

    return (
      <ViewOnCondition condition={window.config.wantsUI}>
        <div class={classes}>
          <Snackbar />

          <aside style={{ zIndex: 500 }} class={`ui-toggle-mobile ${this.state.active ? 'hidden' : ''}`}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                this.setState({ active: !this.state.active })
              }}
              title={unreadChat ? 'Toggle UI (unread chat)' : 'Toggle UI'}
            >
              ☰{unreadChat && <span class="chat-unread-badge" />}
            </button>
          </aside>
          <aside data-active={this.state.active}>
            <ul class="ui-sidebar" onMouseLeave={onBlur}>
              <li>
                <HomeButton grid={this.props.grid} scene={this.props.scene} />
              </li>
              <li>
                <Location signedIn={this.state.signedIn} scene={this.props.scene} />
              </li>

              {!isMobileMedia() && (
                /**
                 * Fullscreen toggle; no point showing "fullscreen on mobile" as most devices are always fullscreen
                 */
                <li title={this.state.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
                  <a
                    onClick={(e) => {
                      e.preventDefault()
                      this.engine.enterFullscreen(!this.state.fullscreen)
                    }}
                    href="#"
                  >
                    {this.state.fullscreen ? `Exit Fullscreen` : `Fullscreen`}
                  </a>
                </li>
              )}

              <li class={active('explorer')}>
                <a href="#explorer" onMouseOver={onHover('explorer')} onClick={onClick('explorer')}>
                  Explore
                </a>
              </li>
              {/* <li class={active('account')}>
                <a href="#" onMouseOver={onHover('account')} onClick={onClick('account')}>
                  Account
                </a>
              </li> */}

              {!this.state.signedIn && (
                <li class={active('login')}>
                  <a href="#" onMouseOver={onHover('login')} onClick={onClick('login')}>
                    Log in
                  </a>
                </li>
              )}

              <li class={active('settings')}>
                <a href="#preferences" onMouseOver={onHover('settings')} onClick={onClick('settings')}>
                  Settings
                </a>
              </li>
              <li class={active('emote')}>
                <a href="#dance" onMouseOver={onHover('emote')} onClick={onClick('emote')}>
                  Dance
                </a>
              </li>
              <li class={active('womp')}>
                <a href="#womps" onMouseOver={onHover('womp')} onClick={onClick('womp')}>
                  Womps
                </a>
              </li>
              <li class={!this.state.signedIn ? 'disabled' : ''}>
                <a href="/costumer" target="_blank" rel="noopener">
                  Costumes
                </a>
              </li>
              {/* <li class={active('summon')}>
                <a title="I for one welcome our robot overlords" onClick={onSummon}>
                  Summon
                </a>
              </li> */}
              <li class={active('info')}>
                <a href="#info" onMouseOver={onHover('info')} onClick={onClick('info')}>
                  Info
                </a>
              </li>
              <li class={active('add', !canEdit)}>
                <a title="Add things to your thing" href="#add" onMouseOver={onHover('add')} onClick={onClick('add')} accessKey="a">
                  Add
                </a>
              </li>
              <li class={active('parcelSnapshots', !canEdit)}>
                <a href="#snapshots" onMouseOver={onHover('parcelSnapshots')} onClick={onClick('parcelSnapshots')}>
                  Shots
                </a>
              </li>
              {/* <li class={active('edit', !canEdit)}>
                <a href="#" onMouseOver={onHover('edit')} onClick={onClick('edit')}>
                  Edit
                </a>
              </li> */}
              <li class={active('inspector', !canEdit)}>
                <a href="#inspector" onMouseOver={onHover('inspector')} onClick={onClick('inspector')}>
                  Tree
                </a>
              </li>

              <li class={active('bake', !canEdit)}>
                <a href="#bake" onMouseOver={onHover('bake')} accessKey="b" onClick={onClick('bake')}>
                  <kbd>B</kbd>ake
                </a>
              </li>
              <li class={active('map')}>
                <a href="#map" onMouseOver={onHover('map')} onClick={() => this.showExplorerMap()}>
                  Map
                </a>
              </li>

              <li class={active('help')}>
                <a href="#help" onMouseOver={onHover('help')} onClick={onClick('help')}>
                  Help
                </a>
              </li>

              {mintable && (
                <u
                  onClick={async (e) => {
                    e.preventDefault()
                    await nearestEditableParcel?.requestMint()
                  }}
                >
                  Mint
                </u>
              )}

              {app.isAdmin() && (
                <li class={active('debugTool')}>
                  <a href="#" onMouseOver={onHover('debugTool')} onClick={onClick('debugTool')}>
                    Debug
                  </a>
                </li>
              )}

              {this.state.signedIn && (
                <>
                  <li>
                    <a href="#" onClick={this.onLogout}>
                      Log out
                    </a>
                  </li>
                </>
              )}
            </ul>

            {this.state.chatEnabled && <ChatOverlay scene={this.props.scene} />}

            {pane && (
              <dialog class="editor" open>
                {pane}
              </dialog>
            )}
          </aside>

          {this.state.scratchpadGuideOpen && !this.state.scratchpadGuideMini && <ScratchpadGuide key={this.state.scratchpadGuideKey || 0} voxelTool={this.voxelTool} onComplete={this.celebrateScratchpadGuideComplete} />}

          {this.state.scratchpadGuideOpen && this.state.scratchpadGuideMini && <ScratchpadGuideMini onGotIt={this.celebrateScratchpadGuideComplete} onStartOver={this.restartScratchpadGuide} />}

          {!this.state.scratchpadGuideOpen && this.state.scratchpadGuideRestart && isScratchpad() && (
            <button type="button" class="scratchpad-guide-restart linkish" onClick={this.openScratchpadGuide}>
              start over
            </button>
          )}

          {nearestEditableParcel && <ToolBelt parcel={nearestEditableParcel} scene={this.props.scene} />}

          <UploadStatusUI onCompleteUpload={onCompleteUpload} onFailUpload={onFailUpload} onBeginUpload={onBeginUpload} ref={this.uploadStatusRef} />
          <ConnectionStatusUI connector={this.connector} grid={this.grid} scene={this.props.scene} />
          {this.props.minimapSettings.enabled && !window.config.isOrbit && !window.config.isSpace && (
            <div class="minimap-corner-controls">
              <button type="button" class="iconish minimap-expand" onClick={() => this.showExplorerMap()} title="Open map">
                M
              </button>
              <button type="button" class="minimap-online-count" onClick={() => this.showExplorerOnline()} title="Who is online">
                {this.state.onlineCount} Online
              </button>
            </div>
          )}
          <OnlyMobile>
            <MobileButtons connector={this.connector} scene={this.props.scene} minimapSettings={this.props.minimapSettings} />
          </OnlyMobile>

          <CongaJoinHintOverlay />
          <CongaStatusOverlay />
        </div>
      </ViewOnCondition>
    )
  }
}
