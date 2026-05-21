/**
 * Capture showbox UI screenshots. Requires localhost:9000.
 * Run: node scripts/capture-showbox-screenshots.mjs
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const OUT = path.join(process.cwd(), 'docs', 'showbox-test-screenshots')
const PW = 'npx --yes playwright@1.49.0 screenshot'
const URL = 'http://localhost:9000/dev/showbox-dock-preview'

function shot(url, file, extra = '') {
  const out = path.join(OUT, file)
  fs.mkdirSync(OUT, { recursive: true })
  execSync(`${PW} ${extra} "${url}" "${out}"`, { cwd: process.cwd(), stdio: 'inherit' })
}

shot(URL, '01-desktop-all-panels.png', '--full-page')
shot(URL, '02-mobile-all-panels.png', '--viewport-size=390,844 --full-page')

fs.writeFileSync(path.join(OUT, 'README.txt'), ['Showbox UI screenshots for PR', new Date().toISOString(), '01-desktop-all-panels.png', '02-mobile-all-panels.png'].join('\n'))
console.log('Done:', OUT)
