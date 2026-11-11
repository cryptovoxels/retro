import rows from './source/shape.json'

// The PNG points north at the top. World +Z points north.
export function onLand(x: number, z: number, size: number) {
  const col = Math.floor((x / size + 0.5) * 256),
    spans = rows[Math.floor((0.5 - z / size) * 256)]
  if (!spans) return false
  for (let i = 0; i < spans.length; i += 2) if (col >= spans[i] && col < spans[i + 1]) return true
  return false
}

type Street = { width: number; height: number; target: [number, number] }

export function packStreets(blocks: Street[]) {
  const area = blocks.reduce((sum, b) => sum + b.width * b.height, 0)
  const fraction = rows.reduce((sum, row) => sum + row.reduce((n, v, i) => n + (i % 2 ? v : -v), 0), 0) / 65536
  const first = Math.max(4, Math.floor(Math.sqrt(area / fraction) / 2) * 2)
  const order = blocks.map((_, i) => i).sort((a, b) => blocks[a].target[1] - blocks[b].target[1] || blocks[b].height - blocks[a].height)
  for (let size = first; size <= 992; size += 2) {
    const positions: [number, number, boolean][] = []
    // Per-row free runs let a later short street fill a coastal pocket left by a longer one.
    const free = Array.from({ length: size }, (_, z) => rows[Math.floor((1 - (z + 0.5) / size) * 256)].map((v) => Math.ceil((v * size) / 256 - 0.5)))
    for (const i of order) {
      const b = blocks[i]
      let placed = false
      for (let z = 0; !placed && z < size; z++) {
        let score = Infinity,
          bx = -1,
          width = 0,
          height = 0,
          turn = false
        for (const rotate of [false, true]) {
          const w = rotate ? b.height : b.width,
            h = rotate ? b.width : b.height
          if (z + h > size) continue
          for (let n = 0; n < free[z].length; n += 2) {
            let x = free[z][n],
              limit = free[z][n + 1]
            while (x + w <= limit) {
              let end = limit,
                next = x
              for (let j = z + 1; j < z + h; j++) {
                const runs = free[j]
                let k = 0
                while (k < runs.length && runs[k + 1] < x + w) k += 2
                if (k === runs.length) {
                  next = limit
                  break
                }
                if (runs[k] > x) {
                  next = runs[k]
                  break
                }
                end = Math.min(end, runs[k + 1])
              }
              if (next > x) {
                x = next
                continue
              }
              for (const edge of [x, end - w]) {
                const cost = h + 0.05 * Math.abs(edge + w / 2 - size * (0.5 + b.target[0]))
                if (cost < score) {
                  bx = edge
                  score = cost
                  width = w
                  height = h
                  turn = rotate
                }
              }
              x = end
            }
          }
        }
        if (bx < 0) continue
        for (let j = z; j < z + height; j++) {
          const runs = free[j],
            k = runs.findIndex((v, k) => k % 2 === 1 && v >= bx + width) - 1
          runs.splice(k, 2, ...(runs[k] < bx ? [runs[k], bx] : []), ...(runs[k + 1] > bx + width ? [bx + width, runs[k + 1]] : []))
        }
        positions[i] = [bx - size / 2, z - size / 2, turn]
        placed = true
      }
      if (!placed) break
    }
    if (order.every((i) => positions[i])) return { size, positions }
  }
  throw new Error('Texas parcels exceed the island ground field')
}
