import fs from 'fs'
import path from 'path'

const styleDir = path.join(process.cwd(), 'web/src/style')
const src = fs.readFileSync(path.join(styleDir, 'app.merged.less'), 'utf8')

const colors = [
  ['#0d0d0d', 'var(--bg)'],
  ['#0D0D0D', 'var(--bg)'],
  ['#f5f5f0', 'var(--fg)'],
  ['#F5F5F0', 'var(--fg)'],
  ['#1a1a1a', 'var(--surface)'],
  ['#222', 'var(--surface-2)'],
  ['#333', 'var(--line)'],
  ['#333a', 'var(--line-trans)'],
  ['#444', 'var(--scroll-track)'],
  ['#666', 'var(--disabled)'],
  ['#888', 'var(--muted)'],
  ['#999', 'var(--muted-2)'],
  ['#aaa', 'var(--border-color)'],
  ['#ccc', 'var(--muted-3)'],
  ['#dc1e1e', 'var(--accent)'],
  ['#e74c3c', 'var(--accent)'],
  ['#f3f3f3', 'var(--hover)'],
  ['#fff', 'var(--fg)'],
  ['#ffffff', 'var(--fg)'],
  ['white', 'var(--fg)'],
  ['black', 'var(--bg)'],
]

let body = src

// strip old header
body = body.replace(/^\/\* flattened[\s\S]*?\*\/\s*/m, '')
body = body.replace(/^\/\*[\s\S]*?THE GREAT MERGE[\s\S]*?\*\/\s*/m, '')

// fighting rules
body = body.replace(/\* \{\s*font-size: unset;\s*\}\s*/g, '')
body = body.replace(/font-family:\s*inherit;\s*/g, '')
body = body.replace(/font-family:\s*'Signika',\s*sans-serif;\s*/g, '')
body = body.replace(/font-family:\s*'Press Start 2P',\s*monospace;\s*/g, '')

// duplicate breakpoint from web.less (variables.less keeps @mobile)
body = body.replace(/\/\/ Functions\s*@mobile: ~'only screen and \(max-width: 800px\)';\s*@pc: ~'only screen and \(min-width: 800px\)';\s*/g, "@pc: ~'only screen and (min-width: 800px)';\n\n")

// merge second :root into tokens block inserted at top
const root2 = body.match(/:root \{\s*font-family:[\s\S]*?--tinge: #[^;]+;\s*\}/)
if (root2) body = body.replace(root2[0], '')

const root1 = body.match(/:root \{[\s\S]*?--chatbar: 3rem;\s*\}/)
if (root1) body = body.replace(root1[0], '')

const tokens = `// --- tokens ---
@mobile: ~'only screen and (max-width: 800px)';
@tiny: ~'only screen and (max-width: 500px)';
@tablet: ~'only screen and (min-width: 500px) and (max-width: 800px)';
@desktop: ~'only screen and (min-width: 800px) and (min-height: 450px)';
@dark: ~'prefers-color-scheme: dark';
@pc: ~'only screen and (min-width: 800px)';
@multiplier: 0.5;

:root {
  --bg: #0d0d0d;
  --fg: #f5f5f0;
  --surface: #1a1a1a;
  --surface-2: #222;
  --line: #333;
  --line-trans: #333a;
  --scroll-track: #444;
  --disabled: #666;
  --muted: #888;
  --muted-2: #999;
  --muted-3: #ccc;
  --border-color: #aaa;
  --hover: #f3f3f3;
  --accent: #dc1e1e;
  --red: var(--accent);
  --axis-x: var(--accent);
  --axis-y: #6bbf59;
  --axis-z: #6b9fd4;
  --border: 1px solid var(--border-color);
  --softborder: 1px solid var(--border-color);
  --soft: var(--muted);
  --semi: rgba(13, 13, 13, 0.85);
  --bright: var(--fg);
  --dark: var(--bg);
  --tinge: var(--surface);
  --chatbar: 3rem;
}

`

// extract @font-face blocks, keep source code pro only
const faces = [...body.matchAll(/@font-face \{[\s\S]*?\}\s*/g)].map((m) => m[0])
body = body.replace(/@font-face \{[\s\S]*?\}\s*/g, '')
const faceKeep = faces.filter((f) => /Source Code Pro|source code pro/i.test(f))
const fonts =
  '// --- fonts ---\n' +
  (faceKeep[0] ||
    `@font-face {
  font-family: 'Source Code Pro';
  font-weight: 400;
  font-display: swap;
  src: local('Source Code Pro'), url(/fonts/sourcecodepro-regular.woff) format('woff');
}

`)

// base block
const base = `// --- base ---
html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Source Code Pro', monospace;
  font-size: 1rem;
  line-height: 1.5;
  margin-bottom: 20rem;
  color: var(--fg);
  background: var(--bg);
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
  margin: 0 0 0.5rem;
}

h1 { font-size: 2.2rem; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.2rem; }
h4, h5, h6 { font-size: 1rem; }

a {
  color: var(--accent);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

button, input, textarea, select {
  font: inherit;
}

* {
  touch-action: manipulation;
}

`

// remove duplicate base chunks from body
body = body.replace(/body,\s*html \{\s*margin: 0;\s*padding: 0;\s*\}\s*body \{[\s\S]*?margin-bottom: 20rem;\s*\}\s*h1,[\s\S]*?h4 \{\s*font-size: 1rem;\s*\}\s*/, '')
body = body.replace(/a \{\s*color: unset;[\s\S]*?color: var\(--red\);\s*\}\s*\}\s*/, '')
body = body.replace(/\* \{\s*touch-action: manipulation;\s*\}\s*/, '')

// vendor block stays at start of body (pickr)
const vendorEnd = body.search(/\/\/ Color pickr|\/\* required styles \*\//)
let vendor = ''
if (vendorEnd >= 0) {
  const costumerStart = body.search(/\n\.costumer|\/\* Forms \*\/|\.costumer-main/)
  const cut = costumerStart > 0 ? costumerStart : body.search(/\n@hexsize:/)
  if (cut > 0) {
    vendor = '// --- vendor ---\n' + body.slice(0, cut).replace(/\/\/ Color pickr\s*/g, '')
    body = body.slice(cut)
  }
}

// replace hardcoded colors in project less (skip vendor minified lines)
const lines = body.split('\n')
const out = []
for (const line of lines) {
  let l = line
  if (!l.includes('.pickr') && !l.includes('.pcr-')) {
    for (const [hex, v] of colors) {
      if (hex === 'white' || hex === 'black') continue
      l = l.split(hex).join(v)
    }
    l = l.replace(/(?<![-\w])white(?![-\w])/g, 'var(--fg)')
    l = l.replace(/(?<![-\w])black(?![-\w])/g, 'var(--bg)')
    l = l.replace(/font-size:\s*10px/g, 'font-size: 0.625rem')
    l = l.replace(/font-size:\s*16px/g, 'font-size: 1rem')
  }
  out.push(l)
}
body = out.join('\n')

const header = `/* one stylesheet: web + in-world, client rules last in source order */

`

const final = header + tokens + fonts + base + vendor + '\n// --- web + components + in-world ---\n' + body

fs.writeFileSync(path.join(styleDir, 'app.less'), final)
fs.unlinkSync(path.join(styleDir, 'app.merged.less'))
console.log('wrote app.less', final.split('\n').length, 'lines')
