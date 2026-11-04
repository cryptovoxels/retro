import { useEffect, useState } from 'preact/hooks'
import { DAY, VoxelRadioEngine } from './engine'
import { ensureRadio, getRadio, onRadioChange } from './global'

export const sec = () => (Date.now() / 1000) % DAY

export const clock = (off: number) => {
  const h = Math.floor(off / 3600) % 24
  const m = Math.floor((off % 3600) / 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

// engine + rerender on change and every second. refresh() forces a rerender
// for volume/transport since the engine doesn't notify on those.
export function useRadio(): [VoxelRadioEngine | null, () => void] {
  const [, bump] = useState(0)
  const [radio, setRadio] = useState<VoxelRadioEngine | null>(null)
  const refresh = () => bump((n) => n + 1)
  useEffect(() => {
    setRadio(getRadio() ?? ensureRadio())
    const off = onRadioChange(refresh)
    const tick = setInterval(refresh, 1000)
    return () => {
      off()
      clearInterval(tick)
    }
  }, [])
  return [radio, refresh]
}

export function transport(r: VoxelRadioEngine | null) {
  if (!r) return
  if (r.muted) r.toggle()
  else if (r.stalled) r.wake()
  else r.toggle()
}
