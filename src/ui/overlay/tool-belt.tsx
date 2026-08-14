import { useEffect, useRef, useState } from 'preact/hooks'
import { blocks, defaultColors } from '../../../common/content/blocks'
import { isMobile } from '../../../common/helpers/detector'
import { requestPointerLock } from '../../../common/helpers/ui-helpers'
import Parcel from '../../parcel'
import { SelectionMode } from '../../tools/voxel'

const DEFAULT_TILESET = '/textures/atlas-ao.png'

type Props = {
  parcel: Parcel
}

export default function VoxelToolBelt({ parcel }: Props) {
  const ui = window.ui
  const voxelTool = ui?.voxelTool
  const [tileset, setTileset] = useState<string | undefined>(parcel.tileset || undefined)
  const [palette, setPalette] = useState<string[] | undefined>(parcel.palette || undefined)
  const [tintChooser, setTintChooser] = useState(false)
  const [texture, setTexture] = useState<number>(voxelTool?.texture ?? 0)
  const [tint, setTint] = useState<number>(voxelTool?.tint ?? 0)
  const [page, setPage] = useState(0)
  const [mode, setMode] = useState<SelectionMode>(voxelTool?.selection?.mode ?? SelectionMode.Add)
  const tintRef = useRef<HTMLDivElement>(null)

  const active = !!voxelTool?.enabled.value
  const currentPalette = palette || defaultColors
  const tilesetUrl = typeof tileset !== 'string' ? DEFAULT_TILESET : process.env.IMG_HOST + tileset

  useEffect(() => {
    const onTiles = parcel.onTileSetUpdate.add(() => {
      setTileset(parcel.tileset || undefined)
      setPalette(parcel.palette || undefined)
    })
    const onTint = voxelTool?.onCurrentTextureTintUpdate.add(({ texture, tint }) => {
      setTexture(texture)
      setTint(tint)
      setPage(texture > 7 ? 1 : 0)
    })
    const onB = voxelTool?.onBuildToolActivate.add(() => setMode(SelectionMode.Add))
    return () => {
      onTiles.remove()
      onTint?.remove()
      onB?.remove()
    }
  }, [parcel, voxelTool])

  useEffect(() => {
    setTileset(parcel.tileset)
    setPalette(parcel.palette)
  }, [parcel.id])

  useEffect(() => {
    if (!tintChooser) return
    const onClick = (e: MouseEvent) => {
      if (tintRef.current && !tintRef.current.contains(e.target as Node)) setTintChooser(false)
    }
    document.addEventListener('pointerdown', onClick)
    return () => document.removeEventListener('pointerdown', onClick)
  }, [tintChooser])

  const lockAndBuild = (next?: SelectionMode) => {
    if (!ui || !voxelTool) return
    window.connector.controls?.enterFirstPerson()
    voxelTool.setMode(next ?? SelectionMode.Add)
    ui.setTool(voxelTool)
    requestPointerLock()
    if (next != null) setMode(next)
  }

  const selectTint = (index: number) => {
    if (!voxelTool) return
    voxelTool.tint = index
    setTint(index)
    setTintChooser(false)
  }

  const selectTexture = (index: number) => {
    if (!voxelTool) return
    voxelTool.texture = index
    setTexture(index)
    lockAndBuild(SelectionMode.Add)
  }

  if (!parcel.canEdit) return null

  const pageSize = 8
  const startIndex = page > 0 ? pageSize : 0
  const textures = blocks.slice(startIndex, startIndex + pageSize).map((_b, index) => {
    const currentTileIndex = startIndex + index
    const j = currentTileIndex + 1
    const y = Math.floor(j / 4)
    const x = j % 4
    const color = currentPalette[tint ?? 0]
    const style = {
      backgroundPositionX: -x * 96 - 28 + 'px',
      backgroundPositionY: -y * 96 - 28 + 'px',
      backgroundImage: `url(${tilesetUrl})`,
    }
    let tip = 'Click to select block'
    if (currentTileIndex < 10) tip += ` [${(currentTileIndex + 1) % 10}]`

    return (
      <div title={tip} class={currentTileIndex === texture ? 'selected' : undefined} style={{ backgroundColor: color }} onClick={() => selectTexture(currentTileIndex)}>
        {currentTileIndex === 1 ? <img src="/images/glass.png" /> : <div style={style} />}
        {!isMobile() && currentTileIndex + 1 < 10 && <span class="keybind-help">{currentTileIndex + 1}</span>}
      </div>
    )
  })

  return (
    <div class={'VoxelToolBelt' + (active ? ' active' : '')} onMouseLeave={() => tintChooser && setTintChooser(false)}>
      <div class="wrapper">
        <div class="dem-buttons">
          <button type="button" class="iconish" title="Add features" onClick={() => ui?.setPane('add')}>
            +
          </button>
          <button type="button" class={'iconish' + (mode === SelectionMode.Paint ? ' selected' : '')} title="Paint [Ctrl+click]" onClick={() => lockAndBuild(SelectionMode.Paint)}>
            P
          </button>
          <button type="button" class={'iconish' + (mode === SelectionMode.Remove ? ' selected' : '')} title="Erase [Shift+click]" onClick={() => lockAndBuild(SelectionMode.Remove)}>
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
          <button type="button" class={'iconish' + (tintChooser ? ' selected' : '')} title="Tint" style={{ background: currentPalette[tint ?? 0] }} onClick={() => setTintChooser(!tintChooser)}>
            T
          </button>
          {tintChooser && (
            <div class="tint-chooser">
              {currentPalette.map((background, index) => (
                <button type="button" style={{ background }} onClick={() => selectTint(index)} />
              ))}
              <button type="button" class="tint-chooser-edit" title="Edit tint colors" onClick={() => ui?.setPane('voxels')}>
                Edit
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
