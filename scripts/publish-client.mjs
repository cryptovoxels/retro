// Publish a clean git tag. The index changes only after every immutable file is uploaded.
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import semver from 'semver'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || ''
const version = tag.replace(/^v(?=\d)/, '')
if (!/^[a-z0-9][a-z0-9.-]*$/.test(version) || version.includes('..')) throw new Error('Use a release tag, e.g. 4-nov-26 or v1.10.0')
const releaseTag = semver.valid(tag) ? `v${tag}` : tag
if (git('status', '--porcelain')) throw new Error('Commit your changes before publishing a release')
const commit = git('rev-parse', 'HEAD')
if (git('rev-parse', `refs/tags/${releaseTag}^{commit}`) !== commit) throw new Error(`HEAD must match tag ${releaseTag}`)

const s3 = new S3Client({ region: 'syd1', endpoint: 'https://syd1.digitaloceanspaces.com', requestChecksumCalculation: 'WHEN_REQUIRED' })
const Bucket = 'voxels-versions'
// Spaces supports conditional writes. One publisher at a time, including local publishes.
await s3.send(new PutObjectCommand({ Bucket, Key: '.publish-lock', Body: JSON.stringify({ version, commit, started: new Date().toISOString() }), IfNoneMatch: '*' }))
try {
  const existing = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `${version}/`, MaxKeys: 1 }))
  if (existing.Contents?.length) throw new Error(`${version} already has files. Published URLs are never overwritten; use a new tag.`)
  const response = await s3.send(new GetObjectCommand({ Bucket, Key: 'releases.json' }))
  const releases = JSON.parse(await response.Body.transformToString())
  execFileSync(process.execPath, ['scripts/bundle-node.mjs', 'client'], { cwd: repo, stdio: 'inherit', env: { ...process.env, RELEASE_VERSION: version } })
  const dir = path.join(repo, '.build/client', version)
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' }
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((file) => file.isFile())
  // Publish metadata last; the release index is the commit point.
  files.sort((a, b) => Number(a.name === 'release.json') - Number(b.name === 'release.json'))
  for (const file of files) {
    const filename = path.join(file.parentPath, file.name)
    const extension = path.extname(filename)
    const compressed = ['.js', '.css', '.json'].includes(extension)
    const bytes = readFileSync(filename)
    await s3.send(
      new PutObjectCommand({
        Bucket,
        Key: `${version}/${path.relative(dir, filename).split(path.sep).join('/')}`,
        Body: compressed ? gzipSync(bytes) : bytes,
        ContentType: types[extension] || 'application/octet-stream',
        ContentEncoding: compressed ? 'gzip' : undefined,
        CacheControl: 'public, max-age=31536000, immutable',
        ACL: 'public-read',
        IfNoneMatch: '*',
      }),
    )
  }
  releases.versions = [...new Set([version, ...releases.versions])]
  // Prereleases are selectable, but never become the default automatically.
  if (!semver.valid(version) || (!semver.prerelease(version) && (!semver.valid(releases.latest) || semver.gt(version, releases.latest)))) releases.latest = version
  await s3.send(new PutObjectCommand({ Bucket, Key: 'releases.json', Body: JSON.stringify(releases), ContentType: 'application/json', CacheControl: 'no-store', ACL: 'public-read' }))
  console.log(`Published https://versions.voxels.com/${version}/client.js`)
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket, Key: '.publish-lock' }))
}
