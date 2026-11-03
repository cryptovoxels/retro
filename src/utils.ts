import { Animations } from './avatar-animations'

export function chatStyle() {
  const body = getComputedStyle(document.body)
  const bar = document.querySelector('.interact-bar')
  const style = bar ? getComputedStyle(bar) : body
  return {
    font: body.fontFamily || 'sans-serif',
    background: style.getPropertyValue('--bg').trim() || style.backgroundColor,
    color: style.getPropertyValue('--fg').trim() || style.color,
    accent: style.getPropertyValue('--accent').trim() || style.color,
  }
}

export function chatLines(ctx: CanvasRenderingContext2D, text: string) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= 464) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word
    while (ctx.measureText(line).width > 464) {
      let end = line.length - 1
      while (end > 1 && ctx.measureText(line.slice(0, end)).width > 464) end--
      if (end > 1 && /[\uD800-\uDBFF]/.test(line[end - 1])) end--
      lines.push(line.slice(0, end))
      line = line.slice(end)
    }
  }
  if (line) lines.push(line)
  if (lines.length > 3) {
    lines.length = 3
    while (ctx.measureText(lines[2] + '...').width > 464) lines[2] = lines[2].slice(0, -1)
    lines[2] += '...'
  }
  return lines
}

export function standing(animation: Animations) {
  return animation === Animations.Idle || animation === Animations.Walk || animation === Animations.Run
}

export function featureOrder(features: import('../common/messages/feature').FeatureRecord[]) {
  const byId = new Map(features.filter(Boolean).map((f) => [f.uuid, f]))
  const seen = new Set<string | undefined>()
  const ordered: typeof features = []
  const visit = (feature: (typeof features)[number]) => {
    if (seen.has(feature.uuid)) return
    seen.add(feature.uuid)
    const parent = feature.groupId && byId.get(feature.groupId)
    if (parent && parent.type === 'group') visit(parent)
    ordered.push(feature)
  }
  for (const feature of byId.values()) visit(feature)
  return ordered
}

export function instanceKey(feature: import('../common/messages/feature').FeatureRecord) {
  if (!['image', 'vox-model', 'cube', 'megavox'].includes(feature.type)) return undefined
  const { uuid, position, rotation, scale, groupId, version, collidable, animation, ...appearance } = feature as any
  return JSON.stringify(appearance, (_key, value) => (value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value))
}
