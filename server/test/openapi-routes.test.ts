import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { expect, test } from 'vitest'

const SERVER = fileURLToPath(new URL('..', import.meta.url))

// express ':id' is '{id}' in openapi
const toOpenApi = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')

const sourceFiles = (dir: string, out: string[] = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'test') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

// app.get('/x', ...) / router.post(`/y`, ...). booting express here would need postgres, so read the source instead
const ROUTE = /\b(?:app|router)\.(get|post|put|delete|patch|all)\(\s*(['"`])([^'"`]*)\2/g

const routes = () => {
  const found: { path: string; where: string }[] = []
  for (const file of sourceFiles(SERVER)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(ROUTE)) {
      if (m[1] !== 'get') continue // writes and app.all catch-alls are never public reads
      found.push({ path: toOpenApi(m[3]), where: `${file.slice(SERVER.length)}:${src.slice(0, m.index).split('\n').length}` })
    }
  }
  return found
}

// top-level keys of the paths: block. no yaml parser is installed and this does not need one
const specPaths = () => {
  const paths = new Set<string>()
  let inPaths = false
  for (const line of readFileSync(join(SERVER, 'openapi.yaml'), 'utf8').split('\n')) {
    if (/^paths:\s*$/.test(line)) inPaths = true
    else if (inPaths && /^\S/.test(line)) break
    else if (inPaths) {
      const m = /^ {2}(\/\S*):\s*$/.exec(line)
      if (m) paths.add(m[1])
    }
  }
  return paths
}

// everything the spec leaves out on purpose. add a rule here only with a reason
const IGNORED = [
  /^\/(login|join|signin|passkey)\//, // auth handshake and account reservation
  /^\/api\/admin\//, // admin tools
  /^\/api\/avatar\/[^/]+\/(suspended|is-moderator)$/, // moderation
  /^\/api\/(rooms|live|clusters|users\/live)\b/, // livekit rooms and presence
  /^\/api\/islands\/[^/]+\/live\.json$/, // presence again
  /^\/api\/(radio|reports|metrics)\b/, // radio, moderation reports, internal metrics
  /^\/api\/parcels\/[^/]+\/metrics$/, // internal metrics
  /^\/(api\/parcels\/[^/]+\/(guest-passes|showbox-guests)|api\/guest\/[^/]+|live\/[^/]+|dev\/.*)$/, // guest passes and showbox
  /^\/api\/favorites\//, // per-wallet favorites, auth gated
  /^\/grid\//, // internal grid writes
  /^\/api\/posts/, // blog
  /^\/api\/(assets|library)\b/, // asset library
  /^\/api\/(externals|nfts)\//, // third party proxies (opensea, alchemy)
  /^\/api\/classifieds\.json$/, // classifieds
  /^\/api\/spaces\/boot\//, // space boot payload
  /^\/api\/islands\/[^/]+\/board\.json$/, // island message board
  /^\/(p\/[^/]+|w\/[^/]+|c\/[^/]+\/[^/]+|c\/v2\/[^/]+\/[^/]+\/[^/]+)$/, // erc721 metadata for marketplaces
  /\/(play|visit)$/, // html pages and visit redirects
  /^\/api\/parcels\/[^/]+\.jpg$/, // redirect to .png
  /^\/(sitemap\.txt|robots\.txt)$/, // seo
  /-app\.(js|css)$/, // versioned static bundles
  /^\/api\/(ping|parcels\/resources\/[^/]+\.json|parcels\/[^/]+\/(users\.json|list))$/, // jwt gated reads
]

test('every GET route is in openapi.yaml or explicitly ignored', () => {
  const spec = specPaths()
  const undocumented = routes()
    .filter((r) => !spec.has(r.path) && !IGNORED.some((re) => re.test(r.path)))
    .map((r) => `GET ${r.path}  (${r.where})`)

  const why = 'these routes are neither in server/openapi.yaml nor ignored. document them, or add an ignore rule with a reason in this file'
  expect(undocumented, why).toEqual([])
})
