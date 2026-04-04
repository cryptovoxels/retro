import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { blocks, defaultColors } from '../../../common/content/blocks'
import { isMobile } from '../../../common/helpers/detector'
import { PanelType } from '../../../web/src/components/panel'
import Snackbar from '../../../web/src/components/snackbar'

import Parcel from '../../parcel'
import type { Scene } from '../../scene'
import { SelectionMode } from '../../tools/voxel'
import UserInterface from '../../user-interface'
import CustomizeVoxels from './customize-voxels'

const DEFAULT_TILESET = '/textures/atlas-ao.png'

function useEffectEvent<T extends (...args: any[]) => any>(fn: T): T {
  return fn
}

interface Props {
  parcel: Parcel
  scene: Scene
}

const VoxelToolBelt = ({ parcel, scene }: Props) => {
  const [tileset, setTileset] = useState<string | undefined>(parcel.tileset || undefined)
  const [palette, setPalette] = useState<string[] | undefined>(parcel.palette || undefined)
  const [tintChooser, setTintChooser] = useState(false)
  const [tintModalOpen, setTintModalOpen] = useState(false)
  const [texture, setTexture] = useState<number | undefined>(window.ui?.voxelTool.texture)
  const [tint, setTint] = useState<number | undefined>(window.ui?.voxelTool.tint)
  const [page, setPage] = useState(0)
  const [mode, setMode] = useState<SelectionMode>(window.ui?.voxelTool.selection?.mode ?? SelectionMode.Add)
  const tintRef = useRef<HTMLDivElement>(null)

  const ui: UserInterface | undefined = window.ui
  const controls = window.connector.controls
  const currentPalette = palette || defaultColors

  const tilesetUrl = typeof tileset !== 'string' ? DEFAULT_TILESET : process.env.IMG_HOST + tileset

  const onTileSetUpdate = useEffectEvent(() => {
    setTileset(parcel.tileset || undefined)
    setPalette(parcel.palette || undefined)
  })

  const onTextureTintUpdate = useEffectEvent(({ texture, tint }) => {
    setTexture(texture)
    setTint(tint)
    const newPage = texture > 7 ? 1 : 0
    setPage(newPage)
  })

  useEffect(() => {
    const observer = parcel?.onTileSetUpdate.add(onTileSetUpdate)
    const observer2 = window.ui?.voxelTool.onCurrentTextureTintUpdate.add(onTextureTintUpdate)
    return () => {
      if (observer) {
        observer.remove()
      }
      if (observer2) {
        observer2.remove()
      }
    }
  }, [parcel, window.ui?.voxelTool])

  useEffect(() => {
    if (!tintChooser) return
    const onClick = (e: MouseEvent) => {
      if (tintRef.current && !tintRef.current.contains(e.target as Node)) {
        setTintChooser(false)
      }
    }
    document.addEventListener('pointerdown', onClick)
    return () => document.removeEventListener('pointerdown', onClick)
  }, [tintChooser])

  useEffect(() => {
    if (!tintModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTintModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tintModalOpen])

  useEffect(() => {
    setTileset(parcel.tileset)
    setPalette(parcel.palette)
  }, [parcel.id])

  const activateBuildTool = () => {
    if (!ui) {
      return
    }
    controls?.enterFirstPerson()
    ui.voxelTool.setMode(SelectionMode.Add)
    ui.setTool(ui.voxelTool)
    ui.closeWithPointerLock()
    setMode(SelectionMode.Add)
  }

  const toggleTintChooser = () => {
    setTintChooser(!tintChooser)
  }

  const openTintModal = () => {
    setTintModalOpen(true)
    setTintChooser(false)
  }

  const selectTint = (index: number) => {
    if (!ui) {
      return
    }
    ui.voxelTool.tint = index
    setTint(index)
    setTintChooser(false)
  }

  const selectTexture = (index: number) => {
    if (!ui) {
      return
    }
    ui.voxelTool.texture = index
    setTexture(index)
    activateBuildTool()
  }

  const activatePaintTool = () => {
    if (!ui) {
      return
    }
    controls?.enterFirstPerson()
    ui.voxelTool.setMode(SelectionMode.Paint, { fixedMode: true })
    ui.setTool(ui.voxelTool)
    ui.closeWithPointerLock()
    setMode(SelectionMode.Paint)
    Snackbar.show('Paint Mode Activated', PanelType.Info, 2000)
  }

  const activateEraseTool = () => {
    if (!ui) {
      return
    }
    controls?.enterFirstPerson()
    ui.voxelTool.setMode(SelectionMode.Remove, { fixedMode: true })
    ui.setTool(ui.voxelTool)
    ui.closeWithPointerLock()
    setMode(SelectionMode.Remove)
    Snackbar.show('Erase Mode Activated', PanelType.Info, 2000)
  }

  if (!parcel || !parcel.canEdit) {
    return null
  }

  const pageSize = 8
  const startIndex = page > 0 ? pageSize : 0
  const textures = blocks.slice(startIndex, startIndex + pageSize).map((b, index) => {
    const j = startIndex + index + 1
    const y = Math.floor(j / 4)
    const x = j % 4
    /**
     * 96 = tile size in atlas
     * 24 = padding on each tile
     */
    const backgroundPositionX = -x * 96 - 28 + 'px'
    const backgroundPositionY = -y * 96 - 28 + 'px'

    const currentTileIndex = startIndex + index

    const glass = currentTileIndex === 1

    const url = tilesetUrl
    const backgroundImage = `url(${url})`

    const style = {
      backgroundPositionX,
      backgroundPositionY,
      backgroundImage,
      backgroundColor: currentPalette[tint || 0],
    }
    let tip = 'Click to select block. Double click to enter build mode.'
    if (currentTileIndex < 10) {
      tip += ` [or press ${(currentTileIndex + 1) % 10}]`
    }

    return (
      <div title={tip} class={currentTileIndex === texture && ('-selected' as any)} onClick={() => selectTexture(currentTileIndex)} onDblClick={() => activateBuildTool()}>
        {glass ? <img src="/images/glass.png" /> : <div style={style} />}
        {!isMobile() && currentTileIndex + 1 < 10 && <span class="keybind-help">{currentTileIndex + 1}</span>}
      </div>
    )
  })

  const tints = currentPalette.map((background, index) => {
    const style = { background }
    return <button style={style} onClick={() => selectTint(index)} />
  })

  return (
    <Fragment>
    <div
      class={'VoxelToolBelt ' + (ui?.voxelTool.enabled.value ? 'active' : '')}
      onMouseLeave={() => {
        if (tintChooser) setTintChooser(false)
      }}
    >
      <div class="wrapper">
        <div class="add-menu-anchor">
          <button
            type="button"
            class="add-menu-toolbelt-btn"
            title="Add features"
            aria-label="Add features"
            onClick={() => ui?.setPane('add')}
          >
            +
          </button>
        </div>
        <div class="tool-modes">
          <button title="Click to activate Paint Mode [Ctrl/Cmd + Click in build mode]" class={'-paint' + (mode === SelectionMode.Paint ? ' -selected' : '')} onClick={activatePaintTool}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 0h18v3h4.5v8.712l-10.5 2.25V15h1.5v9H9v-9h1.5V11.538l10.5-2.25V6h-1.5v1.5H1.5z" fill="currentColor"/></svg>
          </button>
          <button title="Click to activate Erase Mode [Shift + Click in build mode]" class={'-erase' + (mode === SelectionMode.Remove ? ' -selected' : '')} onClick={activateEraseTool}>
            <svg viewBox="3 3 19 17" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="m15.072 3.997 5.679 5.837-3.697 3.696-3.978 3.97h7.928V19H7.935l-3.933-3.933zM10.952 17.5l4.51-4.5-3.635-3.637-5.704 5.704L8.556 17.5z" fill="currentColor"/></svg>
          </button>
        </div>
        <div class="toolbelt-pagination">
          <span data-active={page === 0} onClick={() => setPage(0)}>
            1
          </span>
          <span data-active={page === 1} onClick={() => setPage(1)}>
            2
          </span>
        </div>

        <div class="textures">{textures}</div>

        <div ref={tintRef} class="tint-wrap">
          <button type="button" class={'tint' + (tintChooser ? ' -selected' : '')} title="Choose tint color" onClick={toggleTintChooser}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="28 28 456 456" aria-hidden="true"><path fill="#fff" d="m441 336.2-.06-.05c-9.93-9.18-22.78-11.34-32.16-12.92l-.69-.12c-9.05-1.49-10.48-2.5-14.58-6.17-2.44-2.17-5.35-5.65-5.35-9.94s2.91-7.77 5.34-9.94l30.28-26.87c25.92-22.91 40.2-53.66 40.2-86.59s-14.25-63.68-40.2-86.6c-35.89-31.59-85-49-138.37-49C223.72 48 162 71.37 116 112.11c-43.87 38.77-68 90.71-68 146.24s24.16 107.47 68 146.23c21.75 19.24 47.49 34.18 76.52 44.42a266.17 266.17 0 0 0 86.87 15h1.81c61 0 119.09-20.57 159.39-56.4 9.7-8.56 15.15-20.83 15.34-34.56.21-14.17-5.37-27.95-14.93-36.84ZM112 208a32 32 0 1 1 32 32 32 32 0 0 1-32-32Zm40 135a32 32 0 1 1 32-32 32 32 0 0 1-32 32Zm40-199a32 32 0 1 1 32 32 32 32 0 0 1-32-32Zm64 271a48 48 0 1 1 48-48 48 48 0 0 1-48 48Zm72-239a32 32 0 1 1 32-32 32 32 0 0 1-32 32Z"/></svg>
          </button>
          {tintChooser && (
            <div class="tint-chooser">
              {tints}
              <button type="button" class="tint-chooser-edit" title="Edit tint colors" onClick={() => openTintModal()}>
                Edit
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    {tintModalOpen && (
      <div class="tint-modal-backdrop" onClick={() => setTintModalOpen(false)}>
        <div class="tint-modal-panel" onClick={(e) => e.stopPropagation()}>
          <button type="button" class="tint-modal-close" title="Close" aria-label="Close" onClick={() => setTintModalOpen(false)}>
            x
          </button>
          <CustomizeVoxels parcel={parcel} scene={scene} />
        </div>
      </div>
    )}
    </Fragment>
  )
}

export default VoxelToolBelt
