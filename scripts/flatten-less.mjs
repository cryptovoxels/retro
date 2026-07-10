import fs from 'fs'
import path from 'path'

const styleDir = path.join(process.cwd(), 'web/src/style')
const root = path.join(styleDir, 'app.less')
const seen = new Set()
const out = []

function resolve(importPath, fromDir) {
  let p = importPath
  if (!p.endsWith('.less') && !p.endsWith('.css')) p += '.less'
  if (p.startsWith('./') || p.startsWith('../')) {
    return path.normalize(path.join(fromDir, p))
  }
  return path.join(styleDir, p)
}

function inline(filePath) {
  const key = path.resolve(filePath)
  if (seen.has(key)) return
  seen.add(key)

  if (!fs.existsSync(filePath)) {
    out.push(`/* MISSING: ${filePath} */\n`)
    return
  }

  const dir = path.dirname(filePath)
  const text = fs.readFileSync(filePath, 'utf8')

  for (const line of text.split('\n')) {
    const m = line.match(/^@import\s+(?:\(inline\)\s+)?['"]([^'"]+)['"]/)
    if (m) {
      inline(resolve(m[1], dir))
      continue
    }
    out.push(line)
  }
  out.push('')
}

out.push('/* flattened from app.less import tree */\n')
inline(root)
fs.writeFileSync(path.join(styleDir, 'app.merged.less'), out.join('\n'))
console.log('wrote app.merged.less', out.length, 'lines')
