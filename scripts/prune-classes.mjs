import fs from 'fs'
import path from 'path'

const stylePath = path.join(process.cwd(), 'web/src/style/app.less')
let content = fs.readFileSync(stylePath, 'utf8')

const SKIP = new Set([
  'root',
  'mobile',
  'tiny',
  'tablet',
  'desktop',
  'dark',
  'pc',
  'active',
  'hover',
  'focus',
  'disabled',
  'first',
  'last',
  'child',
  'before',
  'after',
  'important',
  'and',
  'only',
  'screen',
  'not',
  'has',
  'is',
  'where',
  'Microsoft',
  'Roboto',
  'Segoe',
  'Helvetica',
  'Neue',
  'Arial',
  'sans',
  'serif',
  'woff',
  'woff2',
  'ttf',
  'url',
  'format',
  'local',
  'truetype',
  'swap',
  'bold',
  'normal',
  'italic',
])

function collectFiles(dir) {
  const out = []
  const walk = (p) => {
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, ent.name)
      if (ent.isDirectory()) {
        if (ent.name !== 'node_modules') walk(f)
      } else if (/\.(tsx?|jsx?)$/.test(ent.name)) {
        out.push(f)
      }
    }
  }
  walk(dir)
  return out
}

const corpus = collectFiles('src')
  .concat(collectFiles('web'))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n')

function isUsed(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:class|className)\\s*=\\s*["'\`][^"'\`]*\\b${esc}\\b`).test(corpus) || new RegExp(`className:\\s*['"\`]\\b${esc}\\b`).test(corpus) || new RegExp(`["'\`]${esc}["'\`]`).test(corpus)
}

function extractClasses(text) {
  const classes = new Set()
  for (const m of text.matchAll(/\.-?([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    const c = m[1]
    if (!SKIP.has(c) && c.length > 1) classes.add(c)
  }
  return classes
}

const allClasses = extractClasses(content)
const unused = new Set([...allClasses].filter((c) => !isUsed(c)))
console.log(`classes ${allClasses.size}, unused ${unused.size}`)

function selectorClasses(selector) {
  return [...selector.matchAll(/\.-?([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]).filter((c) => !SKIP.has(c))
}

function shouldDrop(selector) {
  const classes = selectorClasses(selector)
  return classes.length > 0 && classes.every((c) => unused.has(c))
}

function dropVendor(text) {
  const a = text.indexOf('// --- vendor ---')
  const b = text.indexOf('// --- web + components + in-world ---')
  if (a >= 0 && b > a) return text.slice(0, a) + '\n' + text.slice(b)
  return text
}

function blockEnd(lines, openIdx) {
  let depth = 0
  for (let k = openIdx; k < lines.length; k++) {
    for (const ch of lines[k]) {
      if (ch === '{') depth++
      if (ch === '}') depth--
    }
    if (depth === 0) return k + 1
  }
  return lines.length
}

function parseSelector(lines, i) {
  let selector = lines[i].trim()
  if (selector.endsWith('{')) selector = selector.slice(0, -1).trim()
  let j = i
  while (j < lines.length && !lines[j].includes('{')) {
    if (j > i) selector += ' ' + lines[j].trim().replace(/,$/, '')
    j++
  }
  if (j >= lines.length || !lines[j].includes('{')) return null
  return { selector, open: j, end: blockEnd(lines, j) }
}

function pruneChunk(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t) {
      out.push(lines[i])
      i++
      continue
    }
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('@')) {
      out.push(lines[i])
      i++
      continue
    }
    const mix = t.match(/^\.([a-zA-Z][\w-]+)(\(\))?\s*;$/)
    if (mix && unused.has(mix[1])) {
      i++
      continue
    }

    const rule = parseSelector(lines, i)
    if (!rule) {
      out.push(lines[i])
      i++
      continue
    }

    if (shouldDrop(rule.selector)) {
      i = rule.end
      continue
    }

    for (let k = i; k <= rule.open; k++) out.push(lines[k])
    out.push(...pruneChunk(lines.slice(rule.open + 1, rule.end - 1)))
    out.push(lines[rule.end - 1])
    i = rule.end
  }
  return out
}

content = dropVendor(content)
content = pruneChunk(content.split('\n'))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')

fs.writeFileSync(stylePath, content)
fs.writeFileSync('/tmp/unused-classes-pruned.json', JSON.stringify([...unused].sort(), null, 2))
console.log('lines', content.split('\n').length)
