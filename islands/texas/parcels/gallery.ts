// Quarter-metre hanging grid. Return a placer so every wall gets a turn at the
// larger pieces before the remaining patches fill with prints and postcards.
export function gallery(cols: number, rows: number, free: (x: number, y: number) => boolean, hang: (x: number, y: number, w: number, h: number) => void, rand: () => number) {
  const space = Uint8Array.from({ length: cols * rows }, (_, i) => Number(free(i % cols, Math.floor(i / cols))))
  return (w: number, h: number) => {
    if (w > cols || h > rows) return false
    const width = cols - w + 1,
      count = width * (rows - h + 1),
      start = Math.floor(rand() * count)
    for (let i = 0; i < count; i++) {
      const slot = (i + start) % count,
        x = slot % width,
        y = Math.floor(slot / width),
        at = x + y * cols
      let fits = true
      for (let j = 0; fits && j < h; j++)
        for (let k = 0; k < w; k++)
          if (!space[at + j * cols + k]) {
            fits = false
            break
          }
      if (!fits) continue
      for (let j = 0; j < h; j++) space.fill(0, at + j * cols, at + j * cols + w)
      hang(x + w / 2, y + h / 2, w, h)
      return true
    }
    return false
  }
}
