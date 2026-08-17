// ABOUTME: esbuild the Playwright page bundle (shared renderable + vox parser).

import * as esbuild from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))

await esbuild.build({
  entryPoints: [path.join(root, 'page/main.ts')],
  bundle: true,
  outfile: path.join(root, 'page/bundle.js'),
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  define: { global: 'globalThis' },
  logLevel: 'info',
})

console.log('renderer page bundle ok')
