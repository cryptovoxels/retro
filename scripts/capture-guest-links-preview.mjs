import { chromium } from 'playwright'
import { mkdir } from 'fs/promises'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs/pr-assets/guest-showbox')
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto('http://127.0.0.1:8765/showbox-guest-links-preview.html', { waitUntil: 'networkidle' })
await page.waitForSelector('#state-open .vectors label')

const shots = [
  ['#state-open', '07-editor-panel-open-no-link.png'],
  ['#state-solo', '08-editor-guest-link-solo.png'],
  ['#state-cohost', '09-editor-guest-link-cohost.png'],
  ['#state-revoked', '10-editor-guest-link-revoked.png'],
]

for (const [sel, file] of shots) {
  await page.locator(sel).screenshot({ path: join(outDir, file) })
}

await browser.close()
console.log('saved 4 screenshots to docs/pr-assets/guest-showbox/')
