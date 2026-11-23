import { useEffect, useRef } from 'preact/hooks'
import type { VoxelsMap } from './helpers/load-voxels-map'
import { loadVoxelsMap } from './helpers/load-voxels-map'

export default function VoxelsMapView() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return

    let dead = false
    let map: VoxelsMap | null = null
    loadVoxelsMap().then(async ({ VoxelsMap: Map }) => {
      if (dead) return
      map = await Map.create(el)
      if (dead) return map.dispose()
      map.load().catch((e) => console.error('voxels map load failed', e))
    })

    return () => {
      dead = true
      map?.dispose()
    }
  }, [])

  return <canvas class="voxels-map" ref={canvas} />
}
