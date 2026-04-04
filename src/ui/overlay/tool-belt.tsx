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
          <div class="tool-modes">
            <button
              class={'iconish -paint' + (mode === SelectionMode.Paint ? ' -selected' : '')}
              title="Paint Mode [Ctrl/Cmd + Click in build mode]"
              onClick={activatePaintTool}
            >
              P
            </button>
            <button
              class={'iconish -erase' + (mode === SelectionMode.Remove ? ' -selected' : '')}
              title="Erase Mode [Shift + Click in build mode]"
              onClick={activateEraseTool}
            >
              E
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
            <button type="button" class={'iconish tint' + (tintChooser ? ' -selected' : '')} title="Tint color" onClick={toggleTintChooser}>
              T
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
