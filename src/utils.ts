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
