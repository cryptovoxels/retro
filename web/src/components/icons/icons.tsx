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
