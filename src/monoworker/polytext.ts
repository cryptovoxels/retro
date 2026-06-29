import { bakePolytextTransform } from './math'

export type FontData = {
  chars: { name: string; data: { indices: number[]; normals: number[]; positions: number[]; uvs: number[] }; advanceWidth: number }[]
}

export type PolytextRenderJobResult = { renderJob: number; positions: number[]; indices: number[]; uvs: number[] }

let data: FontData | null = null

async function meshTextImpl(text: string, renderJob: number): Promise<PolytextRenderJobResult> {
  if (!data) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return meshTextImpl(text, renderJob)
  }

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let x = 0
  let vert = 0

  for (const ch of text) {
    const char = data.chars.find((letter) => letter.name === ch)

    if (!char || !char.data) {
      x += 0.5
      continue
    }

    const base = positions.length / 3
    for (let i = 0; i < char.data.positions.length; i += 3) {
      positions.push(char.data.positions[i] + x, char.data.positions[i + 1], char.data.positions[i + 2])
    }
    uvs.push(...char.data.uvs)
    for (const idx of char.data.indices) {
      indices.push(idx + base)
    }
    x += char.advanceWidth
    vert = positions.length / 3
  }

  if (vert === 0) {
    return { renderJob, positions: [], indices: [], uvs: [] }
  }

  bakePolytextTransform(positions)

  return { renderJob, positions, indices, uvs }
}

export function setFontData(fontData: FontData): void {
  data = fontData
}

export async function meshText(text: string, renderJob: number): Promise<PolytextRenderJobResult> {
  return meshTextImpl(text, renderJob)
}
