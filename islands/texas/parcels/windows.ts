// An unsigned bit used only while building. Roofs, doorways, trim and signs
// never receive it and therefore can't become a pane.
export const windowWall = 1 << 14

export function windows(width: number, height: number, eligible: (x: number, y: number) => boolean, rand: () => number) {
  const panes: { x: number; y: number; w: number; h: number }[] = []
  const stride = width + 1
  const mask = new Int32Array(stride * (height + 1))
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const k = (y + 1) * stride + x + 1
      mask[k] = Number(eligible(x, y)) + mask[k - 1] + mask[k - stride] - mask[k - stride - 1]
    }
  function split(left: number, bottom: number, right: number, top: number, primary: boolean) {
    if (right - left < 2 || top - bottom < 2) return
    let w = Math.min(right - left, primary ? 4 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 3))
    let h = Math.min(top - bottom, primary ? 3 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2))
    let px = 0,
      py = 0,
      found = 0
    while (!found) {
      for (let y = bottom; y <= top - h; y++)
        for (let x = left; x <= right - w; x++) {
          const k = y * stride + x
          if (mask[k + h * stride + w] - mask[k + h * stride] - mask[k + w] + mask[k] !== w * h) continue
          if (rand() < 1 / ++found) {
            px = x
            py = y
          }
        }
      if (!found) {
        if (w > 2) w--
        else if (h > 2) h--
        else return
      }
    }
    panes.push({ x: px, y: py, w, h })
    split(left, bottom, px - 2, top, false)
    split(px + w + 2, bottom, right, top, false)
    split(px, bottom, px + w, py - 2, false)
    split(px, py + h + 2, px + w, top, false)
  }
  split(0, 1, width, height - 1, true)
  return panes
}
