import { Component } from 'preact'
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

const R = 13
const C = 16
const A0 = -135
const SPAN = 270
const pt = (deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180
  return [C + R * Math.cos(a), C + R * Math.sin(a)]
}
const arc = (to: number) => {
  const [x1, y1] = pt(A0)
  const [x2, y2] = pt(to)
  const big = to - A0 > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${big} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}
const FULL = arc(A0 + SPAN)

type KnobProps = { label: string; min: number; max: number; step: number; value: number; small?: boolean; onWake?: () => void; onChange: (v: number) => void }

export class Knob extends Component<KnobProps> {
  y = 0
  v = 0

  down = (e: PointerEvent) => {
    e.preventDefault()
    this.props.onWake?.()
    this.y = e.clientY
    this.v = this.props.value
    window.addEventListener('pointermove', this.move)
    window.addEventListener('pointerup', this.up)
  }
  move = (e: PointerEvent) => {
    const { min, max, step, onChange } = this.props
    let v = this.v + ((this.y - e.clientY) / 120) * (max - min)
    v = Math.max(min, Math.min(max, Math.round(v / step) * step))
    onChange(v)
  }
  up = () => {
    window.removeEventListener('pointermove', this.move)
    window.removeEventListener('pointerup', this.up)
  }

  render() {
    const { label, min, max, value, small } = this.props
    const t = (value - min) / (max - min)
    const size = small ? '1.5rem' : '2rem'
    return (
      <div onPointerDown={this.down} title={label}>
        <svg style={{ marginTop: '4px' }} viewBox="0 0 32 32" width={size} height={size}>
          <path fill="none" stroke="currentColor" stroke-width="4" opacity="0.35" d={FULL} />
          <path fill="none" stroke="currentColor" stroke-width="5" d={arc(A0 + t * SPAN)} />
        </svg>
        {!small && <label>{label}</label>}
      </div>
    )
  }
}
