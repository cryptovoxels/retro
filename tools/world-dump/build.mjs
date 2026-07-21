import * as esbuild from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const outdir = path.join(root, 'dist')
const outfile = path.join(outdir, 'world-dump.js')

fs.mkdirSync(outdir, { recursive: true })

await esbuild.build({
  entryPoints: [path.join(__dirname, 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile,
  external: ['node:sqlite'],
})

// rename to .mjs so Node treats it as ESM without package.json type
const mjs = path.join(outdir, 'world-dump.mjs')
fs.renameSync(outfile, mjs)
console.log(`built ${mjs}`)
