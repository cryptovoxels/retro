import type { Signal } from '@preact/signals'
import { effect } from '@preact/signals'
import { Component, createRef, Fragment } from 'preact'
import { route } from 'preact-router'
import { getCoords, withCoords } from '../web/src/helpers/coords-nav'
import { isMobileMedia } from '../common/helpers/detector'
import { exitPointerLock, hasPointerLock, requestPointerLock } from '../common/helpers/ui-helpers'
import { onBeginUpload, onCompleteUpload, onFailUpload } from '../common/helpers/upload-media'
import { shorterWallet } from '../common/helpers/utils'
import { Login } from '../web/src/auth/login'
import { PanelType } from '../web/src/components/panel'
import Snackbar from '../web/src/components/snackbar'
import Toggle from '../web/src/components/toggle'
import { app, AppEvent } from '../web/src/state'
import { KeyboardHandler } from './components/keyboard-handler'
import { OnlyMobile } from './components/utils'
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
import { Animations } from './avatar-animations'
import { EmoteAnimation } from './states'
import {
  selectCurrentOrNearestParcel,
  selectNearestEditableParcel,
  nearestEditableParcel,
  selectSelectedFeature,
  selectCheckedFeatures,
  selectedFeature,
  setCheckedFeatures,
  setSelectedFeature,
  toggleCheckedFeature,
  enterAuthoring,
  exitAuthoring,
  isPersistentPane,
  uiAsideTick,
  uiPane,
  sidebarClosed,
  pendingWomp,
  closeTakeWomp,
} from './store'
import FeatureTool from './tools/feature'
import VoxelTool, { SelectionMode, SelectionModeOptions } from './tools/voxel'
import ConnectionStatusUI from './ui/connection-status'
import { CongaJoinHintOverlay, CongaStatusOverlay } from './ui/conga-status'
import { MaterialDebugTab } from './ui/debug/material-debug-tab'
import { OceanDebugTab } from './ui/debug/ocean-debug-tab'
import { PumpDebugTab } from './ui/debug/pump-debug-tab'
import { ExplorerUI, Tab } from './ui/explorer'
import { FeatureEditor } from './ui/features/misc'
import HomeButton from './ui/home-button'
import { ChatOverlay, chatSettings } from './ui/interact/chat'
import { voiceSettings } from './voice-settings'
import { DancePane } from './ui/interact/dance-pane'
import { EmotePane } from './ui/interact/emote-pane'
import { HelpOverlay } from './ui/interact/help'
import { ScratchpadGuide, ScratchpadGuideMini } from './ui/scratchpad-guide'
import { FirstTimeInstructions } from '../web/src/components/first-time-instructions'
import { BroadcastSidebarTab } from '../web/src/broadcast-sidebar-tab'
import { ShowboxBroadcastPane } from '../web/src/showbox-broadcast-pane'
import { WompOverlay } from './ui/interact/womps'
import MobileButtons from './ui/mobile/buttons'
import OpenLink from './ui/open-link'
import Baking from './ui/overlay/baking'
import { BuildTab } from './ui/overlay/build-tab/build-tab'
import DebugTools from './ui/overlay/debug-tools'
import EditPane from './ui/overlay/edit-pane'
import CustomizeVoxels from './ui/overlay/customize-voxels'
import ParcelSnapshots from './ui/parcel-snapshots'
import { SettingsUI } from './ui/settings'
import TakeWomp from './ui/take-womp'
import WompButton from './ui/womp-button'

const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const

const Location = (props: { scene: BABYLON.Scene; signedIn: any }) => {
  const currentOrNearestParcel = selectCurrentOrNearestParcel()
  if (!currentOrNearestParcel) {
    return <a href="/">Home</a>
  }

  const owner = currentOrNearestParcel.owner ? shorterWallet(currentOrNearestParcel.owner) : 'nobody'

  const link = `/parcels/${currentOrNearestParcel.id}`

  return (
    <a key={currentOrNearestParcel.id} class="address" href={link}>
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

export type UIPanes = 'add' | 'edit' | 'voxels' | 'debugTool' | 'nfts' | 'chat' | 'dance' | 'emote' | 'settings' | 'womp' | 'takeWomp' | 'help' | 'explorer' | 'login' | 'parcelSnapshots' | 'bake' | 'broadcast'

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
  active: boolean
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
  /** new public womp since last time Explore was opened */
  newWomp: boolean
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
  chatLastReadAt = Date.now()
  chatListDispose?: () => void
  parcelEditDispose?: () => void
  wompPollTimer: ReturnType<typeof setInterval> | null = null
  latestWompId = 0

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
      currentOrNearestParcel: null,
      active: false,
      onlineCount: 0,
      chatEnabled: chatSettings.enabled,
      voiceEnabled: voiceSettings.enabled,
      newWomp: false,
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
    })

    if (signedIn && this.state.pane === 'login') {
      this.setState({ pane: undefined, active: false })
    }
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
      return
    }
    if (!vc.on) {
      void vc.enable().then(() => {
        if (vc.on) this.setState({ voice: 'live' })
      })
      return
    }
    vc.setMuted(false)
    this.setState({ voice: 'live' })
  }

  openEditor(editor: FeatureEditor, feature: Feature) {
    setCheckedFeatures([])
    setSelectedFeature(feature)
    enterAuthoring(feature.parcel.id)
    uiPane.value = 'edit'
    this.setState({ feature, editor: editor, currentOrNearestParcel: feature?.parcel, pane: 'edit', active: true, publishAsset: undefined })
    exitPointerLock()
    // off-object drags look around while editing
    ;(this.connector.controls as any).attachDragLook?.()
  }

  openPublishAsset(asset: FeatureTemplate | string) {
    uiPane.value = 'edit'
    this.setState({ publishAsset: asset, pane: 'edit', active: true })
    uiAsideTick.value++
    exitPointerLock()
  }

  closePublishAsset = () => {
    this.setState({ publishAsset: undefined })
    uiAsideTick.value++
  }

  editShiftSelect(feature: Feature) {
    if (!feature.parcel?.canEdit || hasPointerLock()) return

    const seed = selectSelectedFeature() ?? (this.featureTool.selection?.feature as Feature | undefined)
    toggleCheckedFeature(feature, seed)

    enterAuthoring(feature.parcel.id)
    uiPane.value = 'edit'
    this.featureTool.setMode('edit')
    this.featureTool.highlightFeature(feature as any)

    const multi = Object.keys(selectCheckedFeatures()).length > 0
    this.setState({
      editor: multi ? undefined : this.state.editor,
      feature: multi ? undefined : this.state.feature,
      pane: 'edit',
      active: true,
    })
    uiAsideTick.value++
  }

  showEditBrowse() {
    setCheckedFeatures([])
    selectedFeature.value = undefined
    uiPane.value = 'edit'
    this.featureTool.unHighlight()
    this.setState({ editor: undefined, feature: undefined, pane: 'edit', active: true })
    uiAsideTick.value++
  }

  componentDidMount() {
    app.on(AppEvent.Change, this.onAppChange)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    if (isMobileMedia()) {
      this.canvas.addEventListener('touchstart', () => {
        app.emit(AppEvent.CanvasEngaged)
        this.hide()
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

    chatSettings.addEventListener('changed', this.onChatSettingsChange)
    voiceSettings.addEventListener('changed', this.onVoiceSettingsChange)

    this.chatListDispose = effect(() => {
      messageList.value
      this.forceUpdate()
    })

    // show/hide Add/Edit/etc as you walk onto parcels you can or can't edit
    this.parcelEditDispose = effect(() => {
      nearestEditableParcel.value
      this.forceUpdate()
    })

    // teach Explore: badge when a new public womp lands while you're in world
    void this.pollNewWomp()
    this.wompPollTimer = setInterval(() => void this.pollNewWomp(), 45_000)

    if (isScratchpad() && !isMobileMedia()) {
      this.setState({ scratchpadGuideOpen: true, scratchpadGuideMini: false, scratchpadGuideRestart: false })
    }
  }

  private static WOMP_SEEN_KEY = 'voxels-explore-last-womp'

  private readSeenWompId() {
    try {
      return parseInt(localStorage.getItem(UserInterface.WOMP_SEEN_KEY) || '0', 10) || 0
    } catch {
      return 0
    }
  }

  private writeSeenWompId(id: number) {
    try {
      localStorage.setItem(UserInterface.WOMP_SEEN_KEY, String(id))
    } catch {}
  }

  private pollNewWomp = async () => {
    try {
      const r = await fetch('/api/womps.json?limit=1')
      const d = await r.json()
      const id = d?.womps?.[0]?.id
      if (!id || typeof id !== 'number') return
      this.latestWompId = id
      const seen = this.readSeenWompId()
      if (!seen) {
        // first run: baseline so we don't badge the whole archive
        this.writeSeenWompId(id)
        return
      }
      if (id > seen && !this.state.newWomp) this.setState({ newWomp: true })
    } catch {}
  }

  private markWompsSeen = () => {
    if (this.latestWompId) this.writeSeenWompId(this.latestWompId)
    else {
      const seen = this.readSeenWompId()
      if (seen) this.writeSeenWompId(seen)
    }
    if (this.state.newWomp) this.setState({ newWomp: false })
  }

  enterScratchpadGuideMini = () => {
    exitPointerLock()
    uiPane.value = 'add'
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
    uiPane.value = undefined
    this.setState({
      scratchpadGuideMini: false,
      scratchpadGuideKey: (this.state.scratchpadGuideKey || 0) + 1,
      pane: undefined,
      active: false,
    })
  }

  openScratchpadGuide = () => {
    uiPane.value = undefined
    this.setState({
      scratchpadGuideOpen: true,
      scratchpadGuideMini: false,
      scratchpadGuideRestart: false,
      scratchpadGuideKey: (this.state.scratchpadGuideKey || 0) + 1,
      pane: undefined,
      active: false,
    })
  }

  componentDidUpdate(_prevProps: UserInterfaceProps, prevState: UserInterfaceState) {
    if (!prevState.active && this.state.active) {
      this.chatLastReadAt = Date.now()
    }
    if (prevState.pane !== this.state.pane || prevState.feature?.uuid !== this.state.feature?.uuid) {
      uiAsideTick.value++
    }
    if (this.state.pane === 'explorer' && prevState.pane !== 'explorer') {
      this.markWompsSeen()
    }
  }

  onChatSettingsChange = () => {
    this.setState({ chatEnabled: chatSettings.enabled })
  }

  onVoiceSettingsChange = () => {
    if (!voiceSettings.enabled) {
      void this.connector.persona?.voiceChat?.disable()
      this.setState({ voiceEnabled: false, voice: 'off' })
      return
    }
    this.setState({ voiceEnabled: true })
  }

  updateCanEdit = () => {}

  componentWillUnmount() {
    this.presenceEs?.close()
    this.presenceEs = null
    if (this.wompPollTimer) {
      clearInterval(this.wompPollTimer)
      this.wompPollTimer = null
    }
    app.removeListener(AppEvent.Change, this.onAppChange)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    chatSettings.removeEventListener('changed', this.onChatSettingsChange)
    voiceSettings.removeEventListener('changed', this.onVoiceSettingsChange)
    this.chatListDispose?.()
    this.parcelEditDispose?.()
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
    // full exit: kill selection + edit tool + world sidebar (not tree-only browse), then relock
    const parcelId = this.state.feature?.parcel?.id ?? selectNearestEditableParcel()?.id
    setCheckedFeatures([])
    selectedFeature.value = undefined
    this.featureTool.unHighlight()
    this.featureTool.setMode('edit')
    this.featureTool.selection.feature = undefined // or X/Backspace later deletes the invisible last selection
    this.setTool(this.defaultTool)
    uiPane.value = undefined
    if (parcelId != null) exitAuthoring(parcelId)
    uiAsideTick.value++
    this.setState({ editor: undefined, feature: undefined, pane: undefined, active: false, publishAsset: undefined })
    // controls path avoids focus-before-lock (steals the gesture) and eats the post-unlock cooldown rejection
    const controls = this.connector.controls as any
    controls?.requestPointerLock ? controls.requestPointerLock()?.catch?.(() => {}) : requestPointerLock()
  }

  get camera(): BABYLON.UniversalCamera {
    return this.props.scene.activeCamera as BABYLON.UniversalCamera
  }

  refocus() {
    requestPointerLock()

    uiPane.value = undefined
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
        {
          code: 'KeyE',
          handleEvent: () => {
            // canvas may not have focus (no pointer lock) - still allow hop-in / exit here
            const c = this.connector.controls
            if (c.vehicleFeature || c.findNearbyDriveable()) {
              c.tryEnterVehicle()
              return
            }
            this.editFeatureIfHasLock()
          },
        },
        { code: 'KeyX', handleEvent: () => this.deleteFeature() },
        { code: 'Backspace', handleEvent: () => this.deleteFeature() },
        { code: 'KeyM', handleEvent: () => this.editFeatureThenMove() },
        { code: 'KeyR', handleEvent: () => this.toggleRealism() },
        { code: 'KeyP', handleEvent: () => this.takeWomp(this.props.scene) },
        { code: 'KeyI', handleEvent: () => this.activateInspectorIfHasLock() },
        { code: 'KeyF', handleEvent: () => this.connector.controls.toggleFlying() },
        { code: 'KeyC', handleEvent: () => this.connector.controls.togglePerspective() },
        { code: 'KeyB', handleEvent: () => this.toggleVoxelTool() },
        { code: 'KeyG', handleEvent: () => this.setPane('dance') },
        { code: 'KeyT', handleEvent: () => this.setPane('emote') },
        { code: 'KeyZ', handleEvent: () => this.connector.controls.toggleZoom() },
        { code: 'Enter', handleEvent: this.focusChat },
        { code: 'Escape', handleEvent: () => this.onEscape() },
        {
          code: 'Tab',
          handleEvent: (e: KeyboardEvent) => {
            if (isScratchpad() && this.state.scratchpadGuideOpen) {
              e.preventDefault()
              this.setPane('add')
              return
            }

            if (this.state.pane) return

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
        shiftKey: false,
        handleEvent: () => this.openVoxelCustomize(index),
      })
    })

    // shift-1 .. shift-8 → palette tint 0..7
    for (let i = 0; i < 8; i++) {
      this.keyboardHandler.addKeyDown({
        code: `Digit${i + 1}`,
        shiftKey: true,
        handleEvent: () => this.selectVoxelTint(i),
      })
    }
  }

  openVoxelCustomize(textureIndex: number) {
    if (!this.grid.nearestEditableParcel()) return
    this.voxelTool.setMode(SelectionMode.Add, { texture: textureIndex })
    this.setTool(this.voxelTool)
    if (this.state.pane !== 'voxels') {
      this.setPane('voxels')
    }
  }

  selectVoxelTint(tintIndex: number) {
    if (!this.grid.nearestEditableParcel()) return
    this.voxelTool.tint = tintIndex
    this.voxelTool.setMode(SelectionMode.Add)
    this.setTool(this.voxelTool)
  }

  setPane(pane: UIPanes) {
    if (isScratchpad() && this.state.scratchpadGuideOpen && pane === 'add') {
      this.enterScratchpadGuideMini()
      return
    }

    // opening a pane always reveals the sidebar; if it was collapsed, reveal instead of toggling shut
    const wasCollapsed = sidebarClosed.value
    sidebarClosed.value = false

    if (!wasCollapsed && this.state.pane === pane) {
      this.closeInteractOverlay()
      return
    }

    if (pane === 'edit' || pane === 'add' || pane === 'voxels') {
      const p = selectNearestEditableParcel()
      if (p && (p.canEdit || app.isAdmin())) enterAuthoring(p.id)
    }

    uiPane.value = pane
    // stale editor/feature poisons the add flow (tool taps early-return, click-away misfires)
    if (pane !== 'edit') {
      this.setState({ pane: pane, active: true, editor: undefined, feature: undefined })
    } else {
      this.setState({ pane: pane, active: true })
    }
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
    uiPane.value = undefined
    // ghost editor/feature keeps click-away + drag-look + feature tool in edit limbo
    this.setState({ pane: undefined, active: false, editor: undefined, feature: undefined })
  }

  // the one ESC: leave fullscreen. two-step -- a locked pointer eats the
  // first ESC (browser releases it), the next ESC exits /play back to the parcel.
  onEscape() {
    if (this.connector.controls.vehicleFeature) {
      this.connector.controls.stopVehicle()
      return
    }
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

  hide() {
    uiPane.value = undefined
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
    // tree hover writes selection.feature and never resets — X must delete the SELECTED feature
    const feature = (this.state.feature ?? this.featureTool?.selection?.feature) as Feature | undefined
    if (!feature?.parcel?.canEdit) return

    feature.delete()
    this.featureTool.unHighlight()
    this.closeWithPointerLock()
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
    this.explorerPaneInitialTab.current = 'map'
    uiPane.value = 'explorer'
    this.setState({ pane: 'explorer', active: true })
    setTimeout(() => {
      this.explorerPaneInitialTab.current = undefined
    })
  }

  showExplorerOnline() {
    this.explorerPaneInitialTab.current = 'users'
    uiPane.value = 'explorer'
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

    // withCoords here mangled external URLs to a bare pathname, so every sign/image
    // hyperlink got refused by OpenLink's isExternal check. OpenLink only opens
    // external URLs anyway - coords make no sense on those.
    OpenLink(url)
  }

  paneContent(paneId: UIPanes) {
    const nearestEditableParcel = selectNearestEditableParcel() ?? null
    const currentOrNearestParcel = selectCurrentOrNearestParcel() ?? null

    switch (paneId) {
      case 'add':
        return <BuildTab parcel={nearestEditableParcel || undefined} scene={this.props.scene} />
      case 'edit':
        return <EditPane parcel={nearestEditableParcel} scene={this.props.scene} feature={this.state.feature} editor={this.state.editor} publishAsset={this.state.publishAsset} onClosePublish={this.closePublishAsset} />
      case 'voxels':
        return nearestEditableParcel ? <CustomizeVoxels parcel={nearestEditableParcel} scene={this.props.scene} /> : null
      case 'parcelSnapshots':
        return <ParcelSnapshots parcel={nearestEditableParcel || undefined} scene={this.props.scene} />
      case 'login':
        return <Login />
      case 'debugTool':
        return <DebugTools parcel={currentOrNearestParcel} scene={this.props.scene} environment={this.props.environment} />
      case 'chat':
        return <ChatOverlay scene={this.props.scene} />
      case 'dance':
        return <DancePane />
      case 'emote':
        return <EmotePane />
      case 'settings':
        return <SettingsUI scene={this.props.scene} minimapSettings={this.props.minimapSettings} />
      case 'womp':
        return <WompOverlay scene={this.props.scene} minimapSettings={this.props.minimapSettings} />
      case 'takeWomp': {
        const w = pendingWomp.value
        if (!w) return null
        return <TakeWomp coords={w.coords} parcel={w.parcel} image={w.image} scene={this.props.scene} onClose={closeTakeWomp} />
      }
      case 'help':
        return <HelpOverlay scene={this.props.scene} onShowScratchpadGuide={isScratchpad() ? this.openScratchpadGuide : undefined} />
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
  }

  render() {
    if (!this.state.enabled) {
      return <Fragment />
    }

    const onClick = (p: UIPanes) => (e: any) => {
      e.preventDefault()
      this.setPane(p)
      exitPointerLock()
    }

    const nearestEditableParcel = selectNearestEditableParcel() ?? null
    const mintable = app.isAdmin() && nearestEditableParcel?.needsMint
    const selectedFeature = selectSelectedFeature()

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

    const currentPane = this.state.pane
    const active = (pane: string, disabled?: boolean) => (currentPane === pane ? 'active' : disabled ? 'disabled' : '')

    const unreadChat = this.state.chatEnabled && !this.state.active ? messageList.value.some((m) => m.timestamp > this.chatLastReadAt) : false

    return (
      <>
        <FirstTimeInstructions />
        <div class={classes}>
          <Snackbar />

          {!isMobileMedia() && (
            <div class="top-right">
              <WompButton onClick={() => this.takeWomp(this.props.scene)} />
            </div>
          )}
          {isMobileMedia() && <WompButton onClick={() => this.takeWomp(this.props.scene)} />}

          <aside data-active={this.state.active}>
            <ul class="ui-sidebar" onMouseLeave={onBlur}>
              {!this.state.signedIn && (
                <li class={active('login')}>
                  <a href="#login" onMouseOver={onHover('login')} onClick={onClick('login')}>
                    Login
                  </a>
                </li>
              )}
              <li class={active('explorer')}>
                <a href="#explorer" onMouseOver={onHover('explorer')} onClick={onClick('explorer')} title={this.state.newWomp ? 'new womp - open Explore' : 'Explore'}>
                  Explore{this.state.newWomp ? <span class="explore-new-dot" aria-label="new womp" /> : null}
                </a>
              </li>

              <li class={active('settings')}>
                <a href="#preferences" onMouseOver={onHover('settings')} onClick={onClick('settings')}>
                  Settings
                </a>
              </li>
              <li class={active('dance')}>
                <a href="#dance" onMouseOver={onHover('dance')} onClick={onClick('dance')}>
                  Dance
                </a>
              </li>
              <li class={active('emote')}>
                <a href="#emote" onMouseOver={onHover('emote')} onClick={onClick('emote')}>
                  Emote
                </a>
              </li>
              {(this.state.signedIn || isScratchpad()) && canEdit && (
                <>
                  <li class={active('add')}>
                    <a title="Add things to your thing" href="#add" onMouseOver={onHover('add')} onClick={onClick('add')} accessKey="a">
                      Add
                    </a>
                  </li>
                  <li class={active('parcelSnapshots')}>
                    <a href="#snapshots" onMouseOver={onHover('parcelSnapshots')} onClick={onClick('parcelSnapshots')}>
                      Shots
                    </a>
                  </li>
                  <li class={active('edit')}>
                    <a href="#edit" onMouseOver={onHover('edit')} onClick={onClick('edit')}>
                      Edit
                    </a>
                  </li>
                  <li class={active('voxels')}>
                    <a href="#voxels" onMouseOver={onHover('voxels')} onClick={onClick('voxels')}>
                      Voxels
                    </a>
                  </li>

                  <li class={active('bake')}>
                    <a href="#bake" onMouseOver={onHover('bake')} accessKey="b" onClick={onClick('bake')}>
                      <kbd>B</kbd>ake
                    </a>
                  </li>
                </>
              )}

              {this.state.voiceEnabled && (
                <li title="Microphone">
                  <div class="voice-toggle">
                    Voice
                    <Toggle checked={this.state.voice === 'live'} onChange={() => this.toggleVoice()} />
                  </div>
                </li>
              )}

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
            </ul>

            {this.state.chatEnabled && !location.pathname.startsWith('/chat') && <ChatOverlay scene={this.props.scene} />}
          </aside>

          {this.state.scratchpadGuideOpen && !this.state.scratchpadGuideMini && <ScratchpadGuide key={this.state.scratchpadGuideKey || 0} voxelTool={this.voxelTool} onComplete={this.celebrateScratchpadGuideComplete} />}

          {this.state.scratchpadGuideOpen && this.state.scratchpadGuideMini && <ScratchpadGuideMini onGotIt={this.celebrateScratchpadGuideComplete} onStartOver={this.restartScratchpadGuide} />}

          {!this.state.scratchpadGuideOpen && this.state.scratchpadGuideRestart && isScratchpad() && (
            <button type="button" class="scratchpad-guide-restart linkish" onClick={this.openScratchpadGuide}>
              start over
            </button>
          )}

          <BroadcastSidebarTab />

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
