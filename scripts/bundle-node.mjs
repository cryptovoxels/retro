// ABOUTME: esbuild the production bundles. Dev watches the client only.
// ABOUTME: Node bundles include dependencies. Browser bundles inline public env.

import * as esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'node:child_process'
import less from 'less'
import { fileURLToPath } from 'url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv[2] || 'all'
const buildDate = new Date().toISOString()
const buildNum = process.env.RELEASE_VERSION || 'dev'
if (!/^[a-z0-9][a-z0-9.-]*$/.test(buildNum) || buildNum.includes('..')) throw new Error('Invalid release version')
const clientDir = path.join(repo, '.build/client', buildNum)

const publicEnv = [
  'API',
  'ASSET_PATH',
  'BROADCAST_URL',
  'COLLECTION_FACTORY_CONTRACT_MATIC',
  'CONTRACT_ADDRESS',
  'GRID_SOCKET_URI',
  'IMG_HOST',
  'IMG_URL',
  'MODELS_URL',
  'MUSIC_URL',
  'NODE_ENV',
  'SCRIPTING_URL',
  'SOUNDS_URL',
  'TEXTURE_BUCKET',
  'TEXTURE_CACHEBUSTER',
  'TEXTURE_HOST',
  'WEB_ASSETS',
  'WEB_JS',
  'WEARABLE_CONTRACT_ADDRESS',
  'BUILD_NUM',
  'BUILD_DATE',
]

function loadEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const cut = trimmed.indexOf('=')
    if (cut < 0) continue
    let value = trimmed.slice(cut + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[trimmed.slice(0, cut).trim()] = value
  }
  return out
}

function browserDefine(dev) {
  const file = loadEnv(path.join(repo, dev ? '.env' : '.env.production'))
  const env = {}
  for (const key of publicEnv) {
    const value = process.env[key] ?? file[key]
    if (value !== undefined) env[key] = value
  }
  env.NODE_ENV = dev ? 'development' : 'production'
  env.BUILD_NUM = buildNum
  env.BUILD_DATE = buildDate
  const define = { global: 'globalThis' }
  for (const key of publicEnv) define[`process.env.${key}`] = key in env ? JSON.stringify(env[key]) : 'undefined'
  // anything outside publicEnv reads undefined instead of throwing. server secrets stay out of the client
  define['process'] = JSON.stringify({ env })
  return define
}

function textPlugin() {
  return {
    name: 'text',
    setup(build) {
      build.onLoad({ filter: /\.(md|vsh|fsh|fx)$/ }, (args) => ({
        contents: fs.readFileSync(args.path, 'utf8'),
        loader: 'text',
      }))
    },
  }
}

function emptyBuiltins() {
  return {
    name: 'empty-builtins',
    setup(build) {
      const skip = new Set(['buffer', 'node:buffer'])
      build.onResolve({ filter: /^(node:)?(fs|path|crypto|vm|url|module|os|stream|util|assert|tty|net|tls|dns|http|https|zlib|child_process)$/ }, (args) => {
        if (skip.has(args.path)) return null
        return { path: args.path, namespace: 'empty-builtin' }
      })
      build.onLoad({ filter: /.*/, namespace: 'empty-builtin' }, () => ({
        contents: 'module.exports = {}',
        loader: 'js',
      }))
    },
  }
}

function stubClient() {
  const root = path.join(repo, 'src')
  return {
    name: 'stub-client',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (!args.resolveDir || args.path.startsWith('\0')) return null
        const abs = path.resolve(args.resolveDir, args.path)
        const barrel = abs === root || abs === path.join(root, 'index.ts') || abs === path.join(root, 'index.tsx')
        const map = abs === path.join(root, 'voxels-map') || abs.startsWith(path.join(root, 'voxels-map.'))
        if (!barrel && !map) return null
        return { path: map ? 'map' : 'engine', namespace: 'stub-client' }
      })
      build.onLoad({ filter: /.*/, namespace: 'stub-client' }, (args) => ({
        contents: args.path === 'map' ? 'export {}' : 'export function bootEngine(){return null}\nexport function bootLite(){return null}\n',
        loader: 'js',
      }))
    },
  }
}

function packageOf(file) {
  const parts = file.split('node_modules/')
  const last = parts[parts.length - 1] || ''
  if (last.startsWith('@')) return last.split('/').slice(0, 2).join('/')
  return last.split('/')[0]
}

async function nodeBuild(entry, outfile, external) {
  const skipped = new Set(external)
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await esbuild.build({
        absWorkingDir: repo,
        entryPoints: [entry],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        jsx: 'automatic',
        jsxImportSource: 'preact',
        external: [...skipped],
        define: { 'import.meta.url': '__importMetaUrl' },
        banner: { js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
        plugins: [textPlugin(), entry === 'server/boot.ts' ? stubClient() : null].filter(Boolean),
        logLevel: 'warning',
        legalComments: 'none',
      })
      if (skipped.size) console.log(path.basename(outfile), 'external', [...skipped].join(', '))
      return [...skipped]
    } catch (err) {
      const text = String(err)
      const nodeFile = text.match(/No loader is configured for "\.node" files: ([^\s]+)/)
      if (!nodeFile) throw err
      const name = packageOf(nodeFile[1])
      if (!name || skipped.has(name)) throw err
      skipped.add(name)
      console.log('external native', name)
    }
  }
  throw new Error(`gave up bundling ${entry}`)
}

function browserOptions(dev) {
  return {
    absWorkingDir: repo,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    define: browserDefine(dev),
    inject: [path.join(repo, 'scripts/buffer-shim.js')],
    plugins: [textPlugin(), emptyBuiltins()],
    sourcemap: dev ? 'linked' : false,
    legalComments: 'none',
    logLevel: 'warning',
  }
}

function clientOptions(dev) {
  return {
    ...browserOptions(dev),
    entryPoints: [
      { in: 'web/src/main.tsx', out: 'client' },
      { in: 'src/monoworker.ts', out: 'monoworker' },
    ],
    outdir: dev ? path.join(repo, 'dist') : clientDir,
  }
}

// classic worker: it loads babylon with importScripts, which module workers reject
function thumbWorkerOptions(dev) {
  return {
    ...browserOptions(dev),
    entryPoints: [{ in: 'web/src/workers/voxel-thumb.ts', out: 'voxel-thumb' }],
    outdir: dev ? path.join(repo, 'dist') : clientDir,
    format: 'iife',
  }
}

function previewOptions() {
  return {
    ...browserOptions(false),
    entryPoints: ['src/preview/parcel-preview.ts'],
    outfile: path.join(repo, 'renderer/page/parcel-bundle.js'),
    target: ['chrome120'],
  }
}

const nodeTargets = {
  server: ['server/boot.ts', path.join(repo, 'server/bundle_server.js'), []],
  migrate: ['server/migration/main.ts', path.join(repo, 'server/migrate.js'), []],
  mp: ['multiplayer/src/index.ts', path.join(repo, 'dist/mp.js'), []],
  compressor: ['compressor/src/index.ts', path.join(repo, 'dist/compressor.js'), ['sharp', 'texture-compressor']],
  renderer: ['renderer/src/index.ts', path.join(repo, 'dist/renderer.js'), ['playwright']],
}

async function buildNode(name) {
  const [entry, outfile, external] = nodeTargets[name]
  fs.mkdirSync(path.dirname(outfile), { recursive: true })
  await nodeBuild(entry, outfile, external)
  console.log('built', path.relative(repo, outfile))
}

async function buildClient(dev) {
  fs.mkdirSync(path.join(repo, 'dist'), { recursive: true })
  if (dev) {
    const ctx = await esbuild.context(clientOptions(true))
    const thumb = await esbuild.context(thumbWorkerOptions(true))
    await Promise.all([ctx.watch(), thumb.watch()])
    await ctx.serve({ port: 9200, servedir: path.join(repo, 'dist'), cors: { origin: 'http://localhost:9000' } })
    console.log('client watch http://localhost:9200')
    return
  }
  fs.rmSync(clientDir, { recursive: true, force: true })
  fs.mkdirSync(clientDir, { recursive: true })
  const filename = path.join(repo, 'web/src/style/app.less')
  const css = await less.render(fs.readFileSync(filename, 'utf8'), { filename })
  fs.writeFileSync(path.join(clientDir, 'app.css'), css.css.replaceAll('url(/fonts/', 'url(./fonts/'))
  fs.cpSync(path.join(repo, 'dist/fonts'), path.join(clientDir, 'fonts'), { recursive: true })
  fs.copyFileSync(path.join(repo, 'dist/vendor/library-9.25.0.min.js'), path.join(clientDir, 'babylon.js'))
  await Promise.all([esbuild.build(clientOptions(false)), esbuild.build(thumbWorkerOptions(false))])
  fs.writeFileSync(path.join(clientDir, 'release.json'), JSON.stringify({ version: buildNum, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), builtAt: buildDate }))
  console.log('built', path.relative(repo, clientDir))
}

async function buildLoader() {
  await esbuild.build({ ...browserOptions(false), entryPoints: ['web/loader.ts'], outfile: path.join(repo, 'dist/client-loader.js') })
}

if (arg === 'dev') {
  await buildClient(true)
} else if (arg === 'client') {
  await buildClient(false)
} else if (arg === 'web') {
  await buildLoader()
  await buildNode('server')
  await buildNode('migrate')
} else if (arg === 'renderer') {
  await esbuild.build(previewOptions())
  console.log('built renderer/page/parcel-bundle.js')
  await buildNode('renderer')
} else if (nodeTargets[arg]) {
  if (arg === 'server') await buildLoader()
  await buildNode(arg)
} else if (arg === 'all') {
  await buildClient(false)
  await buildLoader()
  await esbuild.build(previewOptions())
  for (const name of Object.keys(nodeTargets)) await buildNode(name)
} else {
  console.error('unknown target', arg)
  process.exit(1)
}
