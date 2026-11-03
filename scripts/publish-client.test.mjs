import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const { outputFiles } = await build({
  entryPoints: ['scripts/publish-client.mjs'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  define: { 'import.meta.url': JSON.stringify(new URL('./publish-client.mjs', import.meta.url).href) },
  plugins: [
    {
      name: 'publish-fixtures',
      setup(build) {
        build.onLoad({ filter: /publish-client\.mjs$/ }, ({ path }) => {
          const source = readFileSync(path, 'utf8')
          const start = source.indexOf('const repo =')
          return { contents: source.slice(0, start) + 'export default async function() {\n' + source.slice(start) + '\n}' }
        })
        build.onResolve({ filter: /^(@aws-sdk\/client-s3|node:child_process|node:fs)$/ }, ({ path }) => ({ path, namespace: 'fixture' }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === '@aws-sdk/client-s3'
              ? `
          class Command { constructor(input) { this.input = input } }
          export class GetObjectCommand extends Command {}
          export class PutObjectCommand extends Command {}
          export class DeleteObjectCommand extends Command {}
          export class ListObjectsV2Command extends Command {}
          export class S3Client {
            async send(command) {
              const input = command.input;
              state.calls.push({ type: command.constructor.name, ...input });
              if (input.Key === '.publish-lock' && command instanceof PutObjectCommand && state.locked) throw Error('locked');
              if (command instanceof ListObjectsV2Command) return { Contents: state.existing ? [{}] : [] };
              if (command instanceof GetObjectCommand) return { Body: { transformToString: async () => JSON.stringify({ latest: '1.0.0', versions: ['1.0.0'] }) } };
              if (input.Key?.endsWith('/monoworker.js') && state.failUpload) throw Error('upload failed');
              return {};
            }
          }
        `
              : path === 'node:child_process'
                ? `
          export function execFileSync(cmd, args) {
            if (cmd !== 'git') { state.built = true; return ''; }
            return args[0] === 'status' ? (state.dirty ? ' M file' : '') : 'commit';
          }
        `
                : `
          export function readFileSync() { return Buffer.from('compiled bytes'); }
          export function readdirSync(dir) { return ['client.js', 'monoworker.js', 'release.json'].map(name => ({name,parentPath:dir,isFile:()=>true})); }
        `,
        }))
      },
    },
  ],
})

async function publish(state, version = '1.10.0') {
  state.calls = []
  const module = { exports: {} }
  vm.runInNewContext(outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    Buffer,
    console: { log() {} },
    process: { argv: ['node', 'publish', version], execPath: process.execPath, env: {} },
    state,
  })
  await module.exports.default()
}

test('uploads immutable files before advertising a release and releases its lock', async () => {
  const state = {}
  await publish(state)
  const writes = state.calls.filter((c) => c.type === 'PutObjectCommand')
  assert.equal(writes.at(-1).Key, 'releases.json')
  assert.equal(JSON.parse(writes.at(-1).Body).latest, '1.10.0')
  assert(writes.slice(1, -1).every((c) => c.IfNoneMatch === '*' && c.CacheControl.includes('immutable')))
  assert.equal(state.calls.at(-1).type, 'DeleteObjectCommand')
})

test('failed upload never changes the index', async () => {
  const state = { failUpload: true }
  await assert.rejects(publish(state), /upload failed/)
  assert(!state.calls.some((c) => c.Key === 'releases.json' && c.type === 'PutObjectCommand'))
  assert.equal(state.calls.at(-1).type, 'DeleteObjectCommand')
})

test('existing release and competing publisher are rejected', async () => {
  const state = { existing: true }
  await assert.rejects(publish(state), /already has files/)
  assert(!state.built)
  const locked = { locked: true }
  await assert.rejects(publish(locked), /locked/)
  assert.equal(locked.calls.length, 1)
})

test('prereleases do not advance latest; dirty checkouts never upload', async () => {
  const state = {}
  await publish(state, '2.0.0-beta.1')
  const index = JSON.parse(state.calls.find((c) => c.Key === 'releases.json' && c.type === 'PutObjectCommand').Body)
  assert.equal(index.latest, '1.0.0')
  assert(index.versions.includes('2.0.0-beta.1'))
  const dirty = { dirty: true }
  await assert.rejects(publish(dirty), /Commit your changes/)
  assert.equal(dirty.calls.length, 0)
})

test('named release tags publish under their exact name and become latest', async () => {
  const state = {}
  await publish(state, '4-nov-26')
  const index = JSON.parse(state.calls.find((c) => c.Key === 'releases.json' && c.type === 'PutObjectCommand').Body)
  assert.equal(index.latest, '4-nov-26')
  assert(state.calls.some((c) => c.Key === '4-nov-26/client.js'))
})
