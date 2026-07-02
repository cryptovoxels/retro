import { useEffect, useRef } from 'preact/hooks'
import { VoxelsMap } from '../../src/voxels-map'

export default function VoxelsMapView() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return

    const m = new VoxelsMap(el)
    m.load().catch((e) => console.error('voxels map load failed', e))

    return () => m.dispose()
  }, [])

  return <canvas class="voxels-map" ref={canvas} />
}
