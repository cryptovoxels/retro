import { SceneContext } from '@babylonjs/lite'
// ABOUTME: Base interfaces and classes for tabbed debug UI system
// ABOUTME: Provides common tab management and keyboard navigation functionality

export interface IDebugTab {
  readonly name: string

  createContent(): any
  updateContent(): void
  dispose(): void
}

export class DebugUI {
  private scene: SceneContext
  private advancedTexture: any | null = null
  private panel: any | null = null
  private tabHeader: any | null = null
  private contentArea: any | null = null
  private isVisible = false
  private updateInterval: number | null = null
  private tabs: IDebugTab[] = []
  private currentTabIndex = 0
  private keyboardHandler: ((event: KeyboardEvent) => void) | null = null

  private static readonly STORAGE_KEY_VISIBLE = 'debug-ui-visible'
  private static readonly STORAGE_KEY_TAB = 'debug-ui-current-tab'

  constructor(scene: SceneContext) {
    this.scene = scene
    this.loadState()
  }

  addTab(tab: IDebugTab): void {
    this.tabs.push(tab)
  }

  switchToTab(index: number): void {
    if (index < 0 || index >= this.tabs.length) return
    this.currentTabIndex = index
    if (this.isVisible) {
      this.switchToCurrentTab()
    }
    this.saveState()
  }

  getCurrentTab(): IDebugTab | null {
    return this.tabs[this.currentTabIndex] || null
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide()
    } else {
      this.show()
    }
  }

  show(): void {
    if (this.isVisible) return

    this.isVisible = true
    this.createUI()
    this.startUpdating()
    this.setupKeyboardHandler()
    this.saveState()
  }

  hide(): void {
    if (!this.isVisible) return

    this.isVisible = false
    this.stopUpdating()
    this.removeKeyboardHandler()
    this.destroyUI()
    this.saveState()
  }

  private createUI(): void {
    // Create fullscreen UI
    this.advancedTexture = (undefined as any /* todo(lite): BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('DebugUI', true, this.scene) */)

    // Create main panel that fills the left side
    this.panel = (undefined as any /* todo(lite): new BABYLON.GUI.Rectangle('debugPanel') */)
    this.panel.widthInPixels = 340
    this.panel.height = '95%'
    this.panel.cornerRadius = 0
    this.panel.color = '#FF69B4'
    this.panel.thickness = 1
    this.panel.background = '#000000dd'
    this.panel.horizontalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT */)
    this.panel.verticalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP */)
    this.panel.topInPixels = 4
    this.panel.leftInPixels = 4

    this.advancedTexture.addControl(this.panel)

    // Create tab header
    this.tabHeader = (undefined as any /* todo(lite): new BABYLON.GUI.TextBlock('tabHeader', 'Debug') */)
    this.tabHeader.color = '#ffffff'
    this.tabHeader.fontSize = 18
    this.tabHeader.fontWeight = 'bold'
    this.tabHeader.heightInPixels = 30
    this.tabHeader.verticalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP */)
    this.tabHeader.topInPixels = 10

    this.panel.addControl(this.tabHeader)

    // Create content area
    this.contentArea = (undefined as any /* todo(lite): new BABYLON.GUI.Rectangle('contentArea') */)
    this.contentArea.color = 'transparent'
    this.contentArea.thickness = 0
    this.contentArea.paddingTopInPixels = 50
    this.contentArea.paddingBottomInPixels = 30

    this.panel.addControl(this.contentArea)

    // Create close instruction
    const instruction = (undefined as any /* todo(lite): new BABYLON.GUI.TextBlock('instruction', 'press Ctrl+` to close, Ctrl+1-9 to switch tabs') */)
    instruction.color = '#888888'
    instruction.fontSize = 12
    instruction.heightInPixels = 20
    instruction.verticalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM */)
    instruction.topInPixels = -10

    this.panel.addControl(instruction)

    // Load current tab content
    this.switchToCurrentTab()
  }

  private destroyUI(): void {
    if (this.advancedTexture) {
      this.advancedTexture.dispose()
      this.advancedTexture = null
      this.panel = null
      this.tabHeader = null
      this.contentArea = null
    }
  }

  private switchToCurrentTab(): void {
    if (!this.contentArea || !this.tabHeader) return

    const currentTab = this.getCurrentTab()
    if (!currentTab) return

    // Clear existing content
    this.contentArea.clearControls()

    // Update header with tab name and navigation info
    let headerText = currentTab.name
    if (this.tabs.length > 1) {
      headerText += ` (${this.currentTabIndex + 1}/${this.tabs.length})`
    }
    this.tabHeader.text = headerText

    // Add new tab content
    const content = currentTab.createContent()
    this.contentArea.addControl(content)
  }

  private startUpdating(): void {
    if (this.updateInterval) return

    // Update every 100ms for responsive stats
    this.updateInterval = window.setInterval(() => {
      const currentTab = this.getCurrentTab()
      if (currentTab) {
        currentTab.updateContent()
      }
    }, 100)
  }

  private stopUpdating(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
  }

  private setupKeyboardHandler(): void {
    this.keyboardHandler = (event: KeyboardEvent) => {
      // Only handle keys when debug UI is visible
      if (!this.isVisible) return

      if (event.ctrlKey && event.key >= '1' && event.key <= '9') {
        event.preventDefault()
        const tabIndex = parseInt(event.key) - 1
        this.switchToTab(tabIndex)
      }
    }

    document.addEventListener('keydown', this.keyboardHandler)
  }

  private removeKeyboardHandler(): void {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler)
      this.keyboardHandler = null
    }
  }

  private saveState(): void {
    try {
      localStorage.setItem(DebugUI.STORAGE_KEY_VISIBLE, this.isVisible.toString())
      localStorage.setItem(DebugUI.STORAGE_KEY_TAB, this.currentTabIndex.toString())
    } catch (error) {
      // localStorage might not be available in some environments
      console.warn('Failed to save debug UI state to localStorage:', error)
    }
  }

  private loadState(): void {
    try {
      const savedVisible = localStorage.getItem(DebugUI.STORAGE_KEY_VISIBLE)
      const savedTab = localStorage.getItem(DebugUI.STORAGE_KEY_TAB)

      if (savedTab !== null) {
        const tabIndex = parseInt(savedTab)
        if (!isNaN(tabIndex) && tabIndex >= 0) {
          this.currentTabIndex = tabIndex
        }
      }

      // Auto-restore visibility after tabs are added
      if (savedVisible === 'true') {
        // Delay showing until tabs are added
        setTimeout(() => {
          if (this.tabs.length > 0) {
            // Validate tab index bounds after tabs are loaded
            if (this.currentTabIndex >= this.tabs.length) {
              this.currentTabIndex = 0
            }
            this.show()
          }
        }, 100)
      }
    } catch (error) {
      // localStorage might not be available in some environments
      console.warn('Failed to load debug UI state from localStorage:', error)
    }
  }

  dispose(): void {
    this.hide()

    // Dispose all tabs
    for (const tab of this.tabs) {
      tab.dispose()
    }
    this.tabs = []
  }
}
