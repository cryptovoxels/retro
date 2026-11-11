import type { Point2D } from '../utils/polygon-utils'

export function oceanMesh(worldX: number, worldZ: number, size: number, land: Point2D[][], lakes: Point2D[][]) {
  const width = size * 2
  const cells = new Uint8Array(width * width).fill(1)
  // Test each half-metre row at its centre. Between crossing pairs the ring is solid.
  function paint(rings: Point2D[][], water: number) {
    const edges: number[] = []
    for (const ring of rings) {
      for (let row = 0; row < width; row++) {
        const z = worldZ + (row + 0.5) / 2
        edges.length = 0
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i],
            b = ring[j]
          if (a.z > z !== b.z > z) edges.push(a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z))
        }
        edges.sort((a, b) => a - b)
        for (let i = 0; i + 1 < edges.length; i += 2) {
          const left = Math.max(0, Math.ceil((edges[i] - worldX) * 2 - 0.5))
          const right = Math.min(width, Math.ceil((edges[i + 1] - worldX) * 2 - 0.5))
          if (left < right) cells.fill(water, row * width + left, row * width + right)
        }
      }
    }
  }
  paint(land, 0)
  paint(lakes, 1)
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = []
  for (let row = 0; row < width; row++) {
    for (let x = 0; x < width; ) {
      if (!cells[row * width + x]) {
        x++
        continue
      }
      const start = x++
      while (x < width && cells[row * width + x]) x++
      const vertex = positions.length / 3
      for (const [u, v] of [
        [start, row],
        [x, row],
        [x, row + 1],
        [start, row + 1],
      ]) {
        positions.push((u - width / 2) / 2, 0, (v - width / 2) / 2)
        normals.push(0, 1, 0)
        uvs.push(u / width, v / width)
      }
      indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3)
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) }
}
