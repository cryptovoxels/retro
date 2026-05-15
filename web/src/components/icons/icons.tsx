import { ICON_DATA } from './data'

type name = keyof typeof ICON_DATA

export default function Icon({ name, size = 16, color = 'currentColor' }: { name: name; size?: number; color?: string }) {
  const icon = ICON_DATA[name]
  if (!icon) return null
  const rects = []
  for (let i = 0; i < 25; i++) {
    if (icon.bitmap[i]) {
      const x = i % 5
      const y = Math.floor(i / 5)

      rects.push(<rect x={x} y={y} width={1} height={1} />)
    }
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" width={size} height={size} fill={color}>
      {rects}
    </svg>
  )
}

function cubeBoxes(n: name) {
  const bitmap = ICON_DATA[n]?.bitmap
  if (!bitmap) return null
  const boxes = []
  for (let i = 0; i < 25; i++) {
    if (bitmap[i]) {
      const left = (i % 5) + 1
      const top = Math.floor(i / 5)
      boxes.push(
        <div class="box" style={{ left: `${left}rem`, top: `${top}rem` }} key={i}>
          <div class="face-N" />
          <div class="face-E" />
          <div class="face-S" />
          <div class="face-W" />
          <div class="face-F" />
          <div class="face-B" />
        </div>,
      )
    }
  }
  return boxes
}

export function CubeIcon({ name }: { name: name }) {
  return <div class="cube-logo">{cubeBoxes(name)}</div>
}
