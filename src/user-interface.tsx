import type { Signal } from '@preact/signals'
import { effect } from '@preact/signals'
import { Component, createRef, Fragment } from 'preact'
import { route } from 'preact-router'
import { getCoords, paneFromPath, routePane, withCoords } from '../web/src/helpers/coords-nav'
import { isMobileMedia } from '../common/helpers/detector'
import { exitPointerLock, hasPointerLock, requestPointerLock } from '../common/helpers/ui-helpers'
import { onBeginUpload, onCompleteUpload, onFailUpload } from '../common/helpers/upload-media'
import { PanelType } from '../web/src/components/panel'
import Snackbar from '../web/src/components/snackbar'
import { app, AppEvent } from '../web/src/state'
import { KeyboardHandler } from './components/keyboard-handler'
import { OnlyMobile } from './components/utils'
import { Animations } from './avatar-animations'
import { EmoteAnimation } from './states'
import Connector, { messageList } from './connector'
import DesktopControls from './controls/desktop/controls'
import { Environment } from './enviroments/environment'
import { createFeature } from './features/create'
import Feature from './features/feature'
import type { FeatureTemplate } from './features/_metadata'
import type Grid from './grid'
import type { MinimapSettings } from './minimap'
import Parcel from './parcel'
import { isScratchpad } from './scene-config'
import { onLoadPromise } from './utils/loading-done'
import { selectNearestEditableParcel, selectSelectedFeature, selectCheckedFeatures, selectedFeature, setCheckedFeatures, setSelectedFeature, toggleCheckedFeature, uiAsideTick, pendingWomp, closeTakeWomp } from './store'
import FeatureTool from './tools/feature'
import VoxelTool, { SelectionMode, SelectionModeOptions } from './tools/voxel'
import ConnectionStatusUI from './ui/connection-status'
import { CongaJoinHintOverlay, CongaStatusOverlay } from './ui/conga-status'
import { ExplorerUI, Tab } from './ui/explorer'
import { FeatureEditor } from './ui/features/misc'
import { ChatOverlay, chatSettings } from './ui/interact/chat'
import { voiceSettings } from './voice-settings'
import { EmoteOverlay } from './ui/interact/emote'
import { ScratchpadGuide, ScratchpadGuideMini } from './ui/scratchpad-guide'
import { FirstTimeInstructions } from '../web/src/components/first-time-instructions'
import { BroadcastSidebarTab } from '../web/src/broadcast-sidebar-tab'
import { ShowboxBroadcastPane } from '../web/src/showbox-broadcast-pane'
import MobileButtons from './ui/mobile/buttons'
import OpenLink from './ui/open-link'
import Baking from './ui/overlay/baking'
import { BuildTab } from './ui/overlay/build-tab/build-tab'
import EditPane from './ui/overlay/edit-pane'
import CustomizeVoxels from './ui/overlay/customize-voxels'
import ToolBelt from './ui/overlay/tool-belt'
import { SettingsUI } from './ui/settings'
import TakeWomp from './ui/take-womp'
import WompButton from './ui/womp-button'

const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const

export enum Mode {
  Default,
  Voxels,
  Features,
  Parcel,
  Avatar,
}

export type UIPanes = 'add' | 'edit' | 'voxels' | 'emote' | 'settings' | 'takeWomp' | 'explorer' | 'bake' | 'broadcast'

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
  publishAsset?: FeatureTemplate | string
  /** Shown next to minimap expand; same source as Explore radar */
  onlineCount: number
  scratchpadGuideOpen?: boolean
  scratchpadGuideMini?: boolean
  scratchpadGuideRestart?: boolean
  scratchpadGuideKey?: number
  chatEnabled: boolean
  dragging?: boolean
  voice?: 'off' | 'live' | 'muted'
  voiceEnabled: boolean
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

  /**
   * Only used for setting initial tab of the explorer; default undefined
   * We use a ref here to avoid re-renders
   */
  explorerPaneInitialTab = createRef<Tab | undefined>()
  presenceEs: EventSource | null = null
  presenceUuids = new Set<string>()
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
      onlineCount: 0,
      chatEnabled: chatSettings.enabled,
      voiceEnabled: voiceSettings.enabled,
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
  }

  refreshFullscreen = () => {
    this.setState({ fullscreen: !!document.fullscreenElement })
    uiAsideTick.value++
  }

  setDragging = (v: boolean) => this.setState({ dragging: v })

  // enable microphone: off/muted = toggle left, live = toggle right
  toggleVoice = () => {
    if (!voiceSettings.enabled) return
    const vc = this.connector.persona?.voiceChat
    if (!vc) return
    if (this.state.voice === 'live') {
      vc.setMuted(true)
      this.setState({ voice: 'muted' })
      uiAsideTick.value++
      return
    }
    if (!vc.on) {
      void vc.enable().then(() => {
        if (vc.on) {
          this.setState({ voice: 'live' })
          uiAsideTick.value++
        }
      })
      return
    }
    vc.setMuted(false)
    this.setState({ voice: 'live' })
    uiAsideTick.value++
  }

  openEditor(editor: FeatureEditor, feature: Feature) {
    setCheckedFeatures([])
    setSelectedFeature(feature)
    routePane('edit')
    this.setState({ feature, editor: editor, currentOrNearestParcel: feature?.parcel, publishAsset: undefined })
    exitPointerLock()
  }

  openPublishAsset(asset: FeatureTemplate | string) {
    routePane('edit')
    this.setState({ publishAsset: asset })
    uiAsideTick.value++
    exitPointerLock()
  }

  closePublishAsset = () => {
    this.setState({ publishAsset: undefined })
    uiAsideTick.value++
  }

  clearAllExplore() {
    setCheckedFeatures([])
    selectedFeature.value = undefined
    this.featureTool.unHighlight()
    this.deactivateTools()
    this.setState({ feature: undefined, editor: undefined })
  }

  editShiftSelect(feature: Feature) {
    if (!feature.parcel?.canEdit || hasPointerLock()) return

    const seed = selectSelectedFeature() ?? (this.featureTool.selection?.feature as Feature | undefined)
    toggleCheckedFeature(feature, seed)

    routePane('edit')
    this.featureTool.setMode('edit')
    this.featureTool.highlightFeature(feature as any)

    const multi = Object.keys(selectCheckedFeatures()).length > 0
    this.setState({
      editor: multi ? undefined : this.state.editor,
      feature: multi ? undefined : this.state.feature,
    })
    uiAsideTick.value++
  }

  showEditBrowse() {
    setCheckedFeatures([])
    selectedFeature.value = undefined
    routePane('edit')
    this.featureTool.unHighlight()
    this.setState({ editor: undefined, feature: undefined })
    uiAsideTick.value++
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    document.addEventListener('fullscreenchange', this.refreshFullscreen)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    if (isMobileMedia()) {
      this.canvas.addEventListener('touchstart', () => {
        app.emit(AppEvent.CanvasEngaged)
      })
    }

    // setInterval(this.updateCanEdit.bind(this), 1000)

    if (this.props.minimapSettings.enabled && !window.config.isSpace) {
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
    voiceSettings.addEventListener('changed', this.onVoiceSettingsChange)

    this.chatListDispose = effect(() => {
      messageList.value
      this.forceUpdate()
    })
  }

  componentDidUpdate(_prevProps: UserInterfaceProps, prevState: UserInterfaceState) {
    if (prevState.feature?.uuid !== this.state.feature?.uuid) {
      uiAsideTick.value++
    }
  }

  onChatSettingsChange = () => {
    this.setState({ chatEnabled: chatSettings.enabled })
  }

  onVoiceSettingsChange = () => {
    if (!voiceSettings.enabled) {
      void this.connector.persona?.voiceChat?.disable()
      this.setState({ voiceEnabled: false, voice: 'off' })
      uiAsideTick.value++
      return
    }
    this.setState({ voiceEnabled: true })
    uiAsideTick.value++
  }

  enterScratchpadGuideMini = () => {
    exitPointerLock()
    routePane('add')
    this.setState({ scratchpadGuideMini: true })
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
    })
  }

  openScratchpadGuide = () => {
    this.setState({
      scratchpadGuideOpen: true,
      scratchpadGuideMini: false,
      scratchpadGuideRestart: false,
      scratchpadGuideKey: (this.state.scratchpadGuideKey || 0) + 1,
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
    voiceSettings.removeEventListener('changed', this.onVoiceSettingsChange)
    this.chatListDispose?.()
    // dispose the keyboard handler too - it attaches keydown/keyup on `document` in addKeyboardHandlers,
    // and without this each unmount (e.g. womp preview -> /play, every page hop) leaks a live handler.
    // They accumulate and re-fire shortcuts N times, so camera toggles (C perspective, F fly) cancel out.
    this.keyboardHandler?.dispose()
  }

  onPointerLockChange = () => {
    if (document.pointerLockElement) {
      app.emit(AppEvent.CanvasEngaged)
    }
  }

  closeWithPointerLock() {
    requestPointerLock()
  }

  get camera(): BABYLON.UniversalCamera {
    return this.props.scene.activeCamera as BABYLON.UniversalCamera
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

            if (paneFromPath()) return

            this.setPane('add')
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

    if (paneFromPath() === pane) {
      routePane()
      return
    }

    routePane(pane)
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

  // the one ESC: leave fullscreen/theatre. two-step -- a locked pointer eats the
  // first ESC (browser releases it), the next ESC exits /play back to the parcel.
  onEscape() {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    if (document.pointerLockElement) return
    if (!location.pathname.endsWith('/play') && !getCoords()) return
    const id = this.grid?.currentParcel()?.id
    route(id ? withCoords(`/parcels/${id}`) : '/parcels')
  }

  focusChat = (e: KeyboardEvent) => {
    if (!chatSettings.enabled) return

    exitPointerLock()

    const input = document.querySelector('.UserInterface div.chat input') as HTMLInputElement

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
    }
  }

  editFeatureThenMove() {
    if (!this.grid.nearestEditableParcel()) return

    this.setFirstPersonPerspective()
    this.featureTool.setMode('edit')
    this.featureTool.nextMode = 'move'
    this.setTool(this.featureTool)
  }

  editFeatureThenCopy() {
    if (!this.grid.nearestEditableParcel()) return

    this.setFirstPersonPerspective()
    this.featureTool.setMode('edit')
    this.setTool(this.featureTool)
    this.featureTool.nextMode = 'copy'
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
  }

  moveFeature(feature: Feature) {
    this.setFirstPersonPerspective()
    this.featureTool.setModeMove(feature)
    this.setTool(this.featureTool)
  }

  showExplorerMap() {
    this.explorerPaneInitialTab.current = 'map'
    routePane('explorer')
    setTimeout(() => {
      this.explorerPaneInitialTab.current = undefined
    })
  }

  showExplorerOnline() {
    this.explorerPaneInitialTab.current = 'users'
    routePane('explorer')
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
      const params = new URLSearchParams(url.split('?')[1])
      window.location.href = `/play?coords=${params.get('coords')}`
      return
    }

    if (url.startsWith('/spaces') && url.match('/play') && url.match('coords')) {
      const params = new URLSearchParams(url.split('?')[1])
      const spaceId = url.split('/')[2]
      window.location.href = `/spaces/${spaceId}/play?coords=${params.get('coords')}`
      return
    }

    OpenLink(withCoords(url))
  }

  paneContent(paneId: UIPanes) {
    const nearestEditableParcel = selectNearestEditableParcel() ?? null

    switch (paneId) {
      case 'add':
        return <BuildTab parcel={nearestEditableParcel || undefined} scene={this.props.scene} />
      case 'edit':
        return <EditPane parcel={nearestEditableParcel} scene={this.props.scene} feature={this.state.feature} editor={this.state.editor} publishAsset={this.state.publishAsset} onClosePublish={this.closePublishAsset} />
      case 'voxels':
        return nearestEditableParcel ? <CustomizeVoxels parcel={nearestEditableParcel} scene={this.props.scene} /> : null
      case 'emote':
        return <EmoteOverlay />
      case 'settings':
        return <SettingsUI scene={this.props.scene} minimapSettings={this.props.minimapSettings} />
      case 'takeWomp': {
        const w = pendingWomp.value
        if (!w) return null
        return <TakeWomp coords={w.coords} parcel={w.parcel} image={w.image} scene={this.props.scene} onClose={closeTakeWomp} />
      }
      case 'explorer':
        return <ExplorerUI scene={this.props.scene} initialTab={this.explorerPaneInitialTab.current!} />
      case 'bake':
        return <Baking parcel={nearestEditableParcel!} />
      case 'broadcast':
        return <ShowboxBroadcastPane />
      default:
        return null
    }
  }

  showNotificationBanner(message: string, duration = 5000, onClick?: () => void) {
    // ideally we would use a dedicated noitification banner component, but for now we'll use the snackbar
    return Snackbar.show(message, PanelType.Info, duration, onClick)
  }

  enable() {
    this.setState({ enabled: true })
    uiAsideTick.value++
  }

  render() {
    if (!this.state.enabled) {
      return <Fragment />
    }

    const nearestEditableParcel = selectNearestEditableParcel() ?? null
    const classes = `UserInterface parent-overlay toolbar-div`

    return (
      <>
        <FirstTimeInstructions />
        <div class={classes}>
          <Snackbar />

          {this.state.chatEnabled && !location.pathname.startsWith('/chat') && <ChatOverlay scene={this.props.scene} />}

          {this.state.scratchpadGuideOpen && !this.state.scratchpadGuideMini && <ScratchpadGuide key={this.state.scratchpadGuideKey || 0} voxelTool={this.voxelTool} onComplete={this.celebrateScratchpadGuideComplete} />}

          {this.state.scratchpadGuideOpen && this.state.scratchpadGuideMini && <ScratchpadGuideMini onGotIt={this.celebrateScratchpadGuideComplete} onStartOver={this.restartScratchpadGuide} />}

          {!this.state.scratchpadGuideOpen && this.state.scratchpadGuideRestart && isScratchpad() && (
            <button type="button" class="scratchpad-guide-restart linkish" onClick={this.openScratchpadGuide}>
              start over
            </button>
          )}

          {nearestEditableParcel && <ToolBelt parcel={nearestEditableParcel} scene={this.props.scene} />}

          <BroadcastSidebarTab />

          <WompButton onClick={() => this.takeWomp(this.props.scene)} />

          <ConnectionStatusUI connector={this.connector} grid={this.grid} scene={this.props.scene} />
          <OnlyMobile>
            <MobileButtons connector={this.connector} scene={this.props.scene} minimapSettings={this.props.minimapSettings} />
          </OnlyMobile>

          <CongaJoinHintOverlay />
          <CongaStatusOverlay />
        </div>
      </>
    )
  }
}
