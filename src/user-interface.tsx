import type { Signal } from '@preact/signals'
import { effect } from '@preact/signals'
import { Component, Fragment, type ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { route } from 'preact-router'
import { isPlayPath } from '../web/src/helpers/coords-nav'
import { isMobileMedia } from '../common/helpers/detector'
import { exitPointerLock, hasPointerLock, requestPointerLock } from '../common/helpers/ui-helpers'
import { onBeginUpload, onCompleteUpload, onFailUpload } from '../common/helpers/upload-media'
import { Login } from '../web/src/auth/login'
import { PanelType } from '../web/src/components/panel'
import Snackbar from '../web/src/components/snackbar'
import { app, AppEvent } from '../web/src/state'
import { KeyboardHandler } from './components/keyboard-handler'
import { OnlyMobile } from './components/utils'
import Connector from './connector'
import DesktopControls from './controls/desktop/controls'
import { createFeature } from './features/create'
import Feature from './features/feature'
import type { FeatureTemplate } from './features/_metadata'
import type Grid from './grid'
import type { MinimapSettings } from './minimap'
import Parcel from './parcel'
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
  isOnSandboxParcel,
  worldUi,
  mic,
  micEnabled,
  pageToolEl,
  isPageTool,
  pendingWomp,
  closeTakeWomp,
  broadcastLiveStartedAt,
  broadcastShowboxUuid,
  closeBroadcastSidebar,
} from './store'
import FeatureTool from './tools/feature'
import VoxelTool, { SelectionMode, SelectionModeOptions } from './tools/voxel'
import ConnectionStatusUI from './ui/connection-status'
import { CongaJoinHintOverlay, CongaStatusOverlay } from './ui/conga-status'
import { MaterialDebugTab } from './ui/debug/material-debug-tab'
import { OceanDebugTab } from './ui/debug/ocean-debug-tab'
import { PumpDebugTab } from './ui/debug/pump-debug-tab'
import { FeatureEditor } from './ui/features/misc'
import HomeButton from './ui/home-button'
import { ChatOverlay, chatSettings } from './ui/interact/chat'
import { voiceSettings } from './voice-settings'
import { togglePopout } from './ui/interact/popout'
import { HelpOverlay } from './ui/interact/help'
import { FirstTimeInstructions } from '../web/src/components/first-time-instructions'
import { BroadcastSidebarTab } from '../web/src/broadcast-sidebar-tab'
import { ShowboxBroadcastPane } from '../web/src/showbox-broadcast-pane'
import { WompOverlay } from './ui/interact/womps'
import MobileButtons from './ui/mobile/buttons'
import OpenLink from './ui/open-link'
import { BuildTab } from './ui/overlay/build-tab/build-tab'
import DebugTools from './ui/overlay/debug-tools'
import EditPane from './ui/overlay/edit-pane'
import CustomizeVoxels from './ui/overlay/customize-voxels'
import { NftBrowser } from './ui/overlay/nft-browser'
import ParcelSnapshots from './ui/parcel-snapshots'
import { SettingsUI } from './ui/settings'
import { AvatarTab } from './ui/avatar-tab'
import TakeWomp from './ui/take-womp'

const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const

function PageToolPortal({ children }: { children: ComponentChildren }) {
  const el = pageToolEl.value
  if (!el) return null
  return createPortal(children, el)
}

const ROUTE_PANES: Partial<Record<UIPanes, string>> = {
  settings: '/settings',
  avatar: '/avatar',
}

const Location = () => {
  const parcel = selectCurrentOrNearestParcel()
  if (!parcel) return null

  return (
    <a
      class="parcel-location"
      href={`/parcels/${parcel.id}?coords=${encodeURIComponent(window.connector?.controls.getCoords() || '')}`}
      onClick={(e) => {
        if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        exitPointerLock()
        sidebarClosed.value = false
        route(`/parcels/${parcel.id}`, true)
      }}
    >
      <strong>{parcel.name || parcel.address}</strong>
      <span>{parcel.name ? parcel.address : parcel.island}</span>
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

export type UIPanes = 'add' | 'edit' | 'voxels' | 'debugTool' | 'nfts' | 'settings' | 'avatar' | 'womp' | 'takeWomp' | 'help' | 'login' | 'parcelSnapshots' | 'broadcast'

export interface Tool {
  activate: () => void
  deactivate: () => void
  enabled: Signal<boolean>
}

export interface UserInterfaceProps {
  scene: BABYLON.Scene
  canvas: HTMLCanvasElement
  grid: Grid
  connector: Connector
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
  /** Shown next to minimap expand; same source as Explore radar */
  onlineCount: number
  chatEnabled: boolean
  dragging?: boolean
}

export default class UserInterface extends Component<UserInterfaceProps, UserInterfaceState> {
  canvas: HTMLCanvasElement
  visible: boolean
  mode: Mode
  connector: Connector
  grid: Grid

  // sub tools
  activeTool: Tool | null = null
  voxelTool: VoxelTool
  featureTool: FeatureTool
  defaultTool: Tool | null
  keyboardHandler: KeyboardHandler = undefined!

  presenceEs: EventSource | null = null
  presenceUuids = new Set<string>()
  parcelEditDispose?: () => void
  uiPaneDispose?: () => void
  sandboxLookDispose?: () => void
  sandboxRollingBack = false
  compileTimer: ReturnType<typeof setTimeout> | null = null

  constructor(props: UserInterfaceProps) {
    super(props)

    this.visible = false
    this.mode = Mode.Default
    this.canvas = props.canvas
    this.connector = props.connector
    this.grid = props.grid

    this.voxelTool = new VoxelTool(this.props.scene, null, props.grid, this.connector.controls, props.connector)
    this.featureTool = new FeatureTool(this.props.scene, null, props.grid, this.connector.controls, props.connector, createFeature)
    this.defaultTool = null
    window.ui = this

    // this.setTool(this.defaultTool)

    this.addKeyboardHandlers()

    this.state = {
      enabled: props.enabled,
      signedIn: app?.signedIn ?? false,
      wallet: app?.state.wallet ?? null,
      currentOrNearestParcel: null,
      onlineCount: 0,
      chatEnabled: chatSettings.enabled,
    }
    micEnabled.value = voiceSettings.enabled
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
      this.setState({ pane: undefined })
    }
  }

  setDragging = (v: boolean) => this.setState({ dragging: v })

  // enable microphone: off/muted = toggle left, live = toggle right
  toggleVoice = () => {
    if (!voiceSettings.enabled) return
    const vc = this.connector.persona?.voiceChat
    if (!vc) return
    if (mic.value === 'live') {
      vc.setMuted(true)
      mic.value = 'muted'
      return
    }
    if (!vc.on) {
      void vc.enable().then(() => {
        if (vc.on) mic.value = 'live'
      })
      return
    }
    vc.setMuted(false)
    mic.value = 'live'
  }

  openEditor(editor: FeatureEditor, feature: Feature) {
    setCheckedFeatures([])
    setSelectedFeature(feature)
    enterAuthoring(feature.parcel.id)
    uiPane.value = 'edit'
    this.setState({ feature, editor: editor, currentOrNearestParcel: feature?.parcel, pane: 'edit', publishAsset: undefined })
    exitPointerLock()
    // off-object drags look around while editing
    ;(this.connector.controls as any).attachDragLook?.()
  }

  openPublishAsset(asset: FeatureTemplate | string) {
    uiPane.value = 'edit'
    this.setState({ publishAsset: asset, pane: 'edit' })
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
    })
    uiAsideTick.value++
  }

  showEditBrowse() {
    setCheckedFeatures([])
    selectedFeature.value = undefined
    uiPane.value = 'edit'
    this.featureTool.unHighlight()
    this.setState({ editor: undefined, feature: undefined, pane: 'edit' })
    uiAsideTick.value++
  }

  componentDidMount() {
    worldUi.value = this
    app.on(AppEvent.Change, this.onAppChange)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    if (isMobileMedia()) {
      this.canvas.addEventListener('touchstart', () => {
        app.emit(AppEvent.CanvasEngaged)
        this.hide()
      })
    }

    // setInterval(this.updateCanEdit.bind(this), 1000)

    if (this.props.minimapSettings.enabled) {
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

    // showbox attachBroadcastPanel only flips the signal; keep this.state.pane in sync so .ui-pane mounts
    this.uiPaneDispose = effect(() => {
      const p = uiPane.value as UIPanes | undefined
      sidebarClosed.value
      broadcastShowboxUuid.value
      broadcastLiveStartedAt.value
      document.body.classList.toggle('sidebar-closed', sidebarClosed.value)
      if (p !== this.state.pane) this.setState({ pane: p })
      else this.forceUpdate()
      window.engine?.resize()
    })

    // show/hide Add/Edit/etc as you walk onto parcels you can or can't edit
    this.parcelEditDispose = effect(() => {
      nearestEditableParcel.value
      this.forceUpdate()
    })

    this.sandboxLookDispose = effect(() => {
      nearestEditableParcel.value
      const on = isOnSandboxParcel()
      try {
        window._color?.setSandboxLook?.(on)
      } catch {}
    })
  }

  rollBackSandbox = async () => {
    const p = selectNearestEditableParcel()
    if (!p?.sandbox || this.sandboxRollingBack) return
    if (!confirm('Roll back this sandbox to how it looked when you started editing?')) return
    this.sandboxRollingBack = true
    try {
      const r = await fetch(`/api/parcels/${p.id}/sandbox-rollback`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const d = await r.json().catch(() => ({}))
      if (!d?.success) {
        app.showSnackbar(d?.error || 'Nothing to roll back yet', PanelType.Warning)
      }
    } catch {
      app.showSnackbar('Roll back failed', PanelType.Danger)
    } finally {
      this.sandboxRollingBack = false
    }
  }

  componentDidUpdate(_prevProps: UserInterfaceProps, prevState: UserInterfaceState) {
    if (prevState.pane !== this.state.pane || prevState.feature?.uuid !== this.state.feature?.uuid) {
      uiAsideTick.value++
    }
  }

  onChatSettingsChange = () => {
    this.setState({ chatEnabled: chatSettings.enabled })
  }

  onVoiceSettingsChange = () => {
    if (!voiceSettings.enabled) {
      void this.connector.persona?.voiceChat?.disable()
      micEnabled.value = false
      mic.value = 'off'
      return
    }
    micEnabled.value = true
  }

  updateCanEdit = () => {}

  componentWillUnmount() {
    worldUi.value = null
    this.presenceEs?.close()
    this.presenceEs = null
    app.removeListener(AppEvent.Change, this.onAppChange)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    chatSettings.removeEventListener('changed', this.onChatSettingsChange)
    voiceSettings.removeEventListener('changed', this.onVoiceSettingsChange)
    this.parcelEditDispose?.()
    this.uiPaneDispose?.()
    this.sandboxLookDispose?.()
    try {
      window._color?.setSandboxLook?.(false)
    } catch {}
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
    // a live broadcast re-homes the pane (store effect); drop to the live tab, don't desync state
    if (uiPane.value === 'broadcast') sidebarClosed.value = true
    if (parcelId != null) exitAuthoring(parcelId)
    uiAsideTick.value++
    this.setState({ editor: undefined, feature: undefined, pane: uiPane.value as UIPanes | undefined, publishAsset: undefined })
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
    if (uiPane.value === 'broadcast') sidebarClosed.value = true
    this.setState({ pane: uiPane.value as UIPanes | undefined })
  }

  disable() {
    this.setState({ enabled: false })
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
        { code: 'KeyP', handleEvent: () => this.takeWomp(this.props.scene) },
        { code: 'KeyI', handleEvent: () => this.activateInspectorIfHasLock() },
        { code: 'KeyF', handleEvent: () => this.connector.controls.toggleFlying() },
        { code: 'KeyC', handleEvent: () => this.connector.controls.togglePerspective() },
        { code: 'KeyB', handleEvent: () => this.toggleVoxelTool() },
        { code: 'KeyG', handleEvent: () => togglePopout('dance') },
        { code: 'KeyT', handleEvent: () => togglePopout('emote') },
        { code: 'KeyZ', handleEvent: () => this.connector.controls.toggleZoom() },
        { code: 'Enter', handleEvent: this.focusChat },
        { code: 'Escape', handleEvent: () => this.onEscape() },
        {
          code: 'Tab',
          handleEvent: (e: KeyboardEvent) => {
            if (this.state.pane) return

            this.setPane('add')
            return
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
    if (pane === 'broadcast') return
    const path = ROUTE_PANES[pane]
    if (path) {
      exitPointerLock()
      route(path)
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
      this.setState({ pane: pane, editor: undefined, feature: undefined })
    } else {
      this.setState({ pane: pane })
    }
  }

  openBuildToolbelt() {
    if (!this.grid.nearestEditableParcel()) return
    this.voxelTool.setMode(SelectionMode.Add)
    this.setTool(this.voxelTool)
    this.forceUpdate()
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
    // live showbox: collapse to the pulsing edge tab, keep the dock mounted
    if (uiPane.value === 'broadcast' && broadcastLiveStartedAt.value) {
      sidebarClosed.value = true
      return
    }
    if (uiPane.value === 'broadcast') {
      const uuid = broadcastShowboxUuid.value
      const feature = uuid ? (selectCurrentOrNearestParcel() || selectNearestEditableParcel())?.getFeatureByUuid(uuid) : undefined
      if (feature && typeof (feature as any).dismissBroadcastPanel === 'function') {
        ;(feature as any).dismissBroadcastPanel()
        ;(feature as any).clearBroadcastDockUi?.()
      } else {
        closeBroadcastSidebar()
      }
      this.setState({ pane: undefined, editor: undefined, feature: undefined })
      return
    }
    uiPane.value = undefined
    // ghost editor/feature keeps click-away + drag-look + feature tool in edit limbo
    this.setState({ pane: undefined, editor: undefined, feature: undefined })
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
    if (!isPlayPath()) return
    const id = this.grid?.currentParcel()?.id
    route(id ? `/parcels/${id}` : '/parcels')
  }

  focusChat = (e: KeyboardEvent) => {
    if (!chatSettings.enabled) return

    exitPointerLock()

    const input = document.querySelector<HTMLInputElement>('.canvasdom div.chat input')
    if (!input || document.activeElement === input) return
    // defer so the Enter keydown that opened chat does not land in the input
    setTimeout(() => input.focus())
  }

  setTool(tool: Tool | null) {
    if (this.activeTool === tool) return
    const leavingVoxel = this.activeTool === this.voxelTool && tool !== this.voxelTool
    this.activeTool?.deactivate()
    tool?.activate()
    this.activeTool = tool
    if (leavingVoxel) this.scheduleCompile()
  }

  scheduleCompile() {
    if (this.compileTimer) clearTimeout(this.compileTimer)
    this.compileTimer = setTimeout(() => {
      this.compileTimer = null
      for (const p of window.user?.parcels || []) {
        if (p.canEdit) void p.compile()
      }
    }, 1000)
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
    if (uiPane.value === 'broadcast') sidebarClosed.value = true
    this.setState({ pane: uiPane.value as UIPanes | undefined })
  }

  highlightFeature(feature: Feature) {
    this.setFirstPersonPerspective()
    this.featureTool.setMode('edit')
    this.setTool(this.featureTool)
    this.featureTool.highlightFeature(feature)
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

    if (feature) {
      this.featureTool.highlightFeature(feature)
      this.featureTool.editFeature(feature)
    } else {
      this.hide()
    }
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
    this.featureTool.setModeAdd(feature)
    this.setTool(this.featureTool)
    this.hide()
  }

  moveFeature(feature: Feature) {
    this.setFirstPersonPerspective()
    this.featureTool.setModeMove(feature)
    this.setTool(this.featureTool)
    this.hide()
  }

  openLink(url: string) {
    if (this.visible && !(window.scene?.activeCamera instanceof BABYLON.WebXRCamera)) {
      // suppress
      return
    }

    if (url.startsWith('/play') && url.match('coords')) {
      const params = new URLSearchParams(url.split('?')[1])
      window.location.href = `/play?coords=${params.get('coords')}`
      return
    }

    if (url.startsWith('/spaces/')) {
      const parts = url.split('/')
      const spaceId = parts[2]
      if (spaceId) route(`/spaces/${spaceId}/play`)
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
      case 'nfts':
        return <NftBrowser />
      case 'edit':
        return <EditPane parcel={nearestEditableParcel} scene={this.props.scene} feature={this.state.feature} editor={this.state.editor} publishAsset={this.state.publishAsset} onClosePublish={this.closePublishAsset} />
      case 'voxels':
        return nearestEditableParcel ? <CustomizeVoxels parcel={nearestEditableParcel} scene={this.props.scene} /> : null
      case 'parcelSnapshots':
        return <ParcelSnapshots parcel={nearestEditableParcel || undefined} scene={this.props.scene} />
      case 'login':
        return <Login />
      case 'debugTool':
        return <DebugTools parcel={currentOrNearestParcel} scene={this.props.scene} />
      case 'settings':
        return <SettingsUI scene={this.props.scene} minimapSettings={this.props.minimapSettings} />
      case 'avatar':
        return <AvatarTab />
      case 'womp':
        return <WompOverlay scene={this.props.scene} minimapSettings={this.props.minimapSettings} />
      case 'takeWomp': {
        const w = pendingWomp.value
        if (!w) return null
        return <TakeWomp coords={w.coords} parcel={w.parcel} image={w.image} metadata={w.metadata} scene={this.props.scene} onClose={closeTakeWomp} />
      }
      case 'help':
        return <HelpOverlay scene={this.props.scene} />
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

    const nearestEditableParcel = selectNearestEditableParcel() ?? null
    const currentPane = this.state.pane
    const chat = !location.pathname.startsWith('/chat')

    return (
      <>
        {isPageTool(currentPane) && <PageToolPortal>{this.paneContent(currentPane!)}</PageToolPortal>}
        <div class="canvasdom">
          <Location />
          <FirstTimeInstructions />

          {chat && <ChatOverlay enabled={this.state.chatEnabled} />}

          {nearestEditableParcel?.sandbox && nearestEditableParcel.canEdit && (
            <div class="sandbox-rollback">
              <button type="button" class="linkish" onClick={this.rollBackSandbox}>
                roll back
              </button>
            </div>
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
