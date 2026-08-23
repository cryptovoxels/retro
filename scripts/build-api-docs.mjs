// ABOUTME: Turn server/openapi.yaml into API.md (the /api page) and llms.txt.
// ABOUTME: Both outputs are generated, never hand edited. Run: npm run docs:api

import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const specPath = fileURLToPath(new URL('../server/openapi.yaml', import.meta.url))
const mdPath = fileURLToPath(new URL('../API.md', import.meta.url))
const llmsPath = fileURLToPath(new URL('../llms.txt', import.meta.url))

// prettier already ships a yaml parser, so we don't need a yaml dependency.
// It hands back its own AST, so flatten that to plain objects first.
const yamlPlugin = await import('prettier/plugins/yaml')

function toJs(node) {
  if (!node) return null
  switch (node.type) {
    case 'root':
    case 'document':
    case 'documentBody':
      return toJs(node.children.find((c) => c.type !== 'documentHead'))
    case 'mapping':
    case 'flowMapping': {
      const out = {}
      for (const item of node.children) {
        const [key, value] = item.children
        if (!key) continue
        out[toJs(key.children[0])] = value ? toJs(value.children[0]) : null
      }
      return out
    }
    case 'sequence':
    case 'flowSequence':
      return node.children.map((item) => (item.children[0] ? toJs(item.children[0]) : null))
    default:
      return node.value ?? null
  }
}

const parsers = (yamlPlugin.default ?? yamlPlugin).parsers
const spec = toJs(await parsers.yaml.parse(readFileSync(specPath, 'utf8'), {}))
const base = spec.servers[0].url

// The only prose that isn't in the spec: one line per tag for llms.txt.
const blurbs = {
  parcels: 'Land. Bounds, owners, sales, and the build with its voxels and features.',
  womps: 'Photographs taken in world, with their captions, coordinates and pictures.',
  avatars: 'Citizens: names, wallets, home parcel and the costume they are wearing.',
  collectibles: 'Minted wearables, including the MagicaVoxel model behind one.',
  collections: 'Wearable collections and the wearables inside them.',
  wearables: 'Wearables by id or by contract, and their models.',
  islands: 'The archipelago: shorelines, holes, lakes and where each island sits.',
  spaces: 'Hosted spaces, which are worlds that are not parcels.',
  events: 'What is on, and where.',
  search: 'One query across parcels, wearables, collections and citizens.',
}

// GitHub's heading slugs, so a link works both here and on the rendered page:
// lowercase, drop punctuation but keep hyphens and underscores, spaces to
// hyphens. Underscores matter, {chain_identifier} is in eight route headings.
// web/src/api-doc.tsx repeats this rule to put ids on the headings micromark
// renders, and the check at the bottom of this file stops the two drifting.
function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-')
}

function code(v) {
  return '`' + String(v) + '`'
}

// A $ref reads as the schema's name, linked to its entry under ## schemas.
function refLink(ref) {
  const name = ref.split('/').pop()
  return `[${code(name)}](#${slug(name)})`
}

function typeOf(schema) {
  if (!schema) return 'anything'
  if (schema.$ref) return refLink(schema.$ref)
  if (schema.format === 'binary') return 'bytes'
  if (schema.oneOf) return schema.oneOf.map(typeOf).join(' or ')
  if (schema.allOf) return schema.allOf.map(typeOf).join(' plus ')

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  const items = schema.items ? typeOf(schema.items) : ''
  let out = types.map((t) => (t === 'array' && items ? `array of ${items}` : t)).join(' or ')
  if (!out) out = schema.properties ? 'object' : 'anything'

  if (schema.enum) out += `, one of ${schema.enum.map(code).join(', ')}`
  if (schema.const !== undefined && schema.const !== null) out += `, always ${code(schema.const)}`
  if (schema.default !== undefined && schema.default !== null) out += `, defaults to ${code(schema.default)}`
  if (schema.format === 'uuid') out += ', a uuid'
  return out
}

// A description is a block scalar: keep the paragraph breaks, drop the wrapping.
function paragraphs(text) {
  if (!text) return []
  return String(text)
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
}

function describe(text, indent) {
  const parts = paragraphs(text)
  if (!parts.length) return { head: '', rest: [] }
  return { head: parts[0], rest: parts.slice(1).map((p) => `\n\n${indent}${p}`) }
}

// One bullet per property, nesting into inline objects. Named schemas stop the
// recursion: they get their own entry further down the page.
function fields(schema, indent = '', lines = []) {
  if (!schema) return lines
  if (schema.allOf) {
    for (const part of schema.allOf) {
      if (part.$ref) lines.push(`${indent}- everything in ${refLink(part.$ref)}`)
      else fields(part, indent, lines)
    }
    return lines
  }
  if (schema.oneOf) {
    for (const part of schema.oneOf) {
      lines.push(`${indent}- ${typeOf(part)}`)
      fields(part, `${indent}  `, lines)
    }
    return lines
  }
  if (!schema.properties) {
    if (schema.items) fields(schema.items, indent, lines)
    return lines
  }

  for (const [name, prop] of Object.entries(schema.properties)) {
    const { head, rest } = describe(prop.description, `${indent}  `)
    lines.push(`${indent}- ${code(name)} ${typeOf(prop)}${head ? `: ${head}` : ''}${rest.join('\n')}`)
    // $ref and oneOf are already named on the line above, so don't unpack them.
    if (!prop.$ref && !prop.oneOf) fields(prop.items ?? prop, `${indent}  `, lines)
  }
  return lines
}

function resolve(node) {
  if (!node?.$ref) return node
  const [, , section, name] = node.$ref.split('/')
  return spec.components[section][name]
}

function renderParam(param) {
  const p = resolve(param)
  const where = [p.in, p.required === 'true' ? 'required' : ''].filter(Boolean).join(', ')
  const { head, rest } = describe(p.description, '  ')
  return `- ${code(p.name)} (${where}) ${typeOf(p.schema)}${head ? `: ${head}` : ''}${rest.join('\n')}`
}

function renderResponse(status, response) {
  const r = resolve(response)
  if (response.$ref) return [`- ${code(status)} ${paragraphs(r.description)[0]}`]

  const [mediaType, media] = Object.entries(r.content ?? {})[0] ?? []
  if (!mediaType) return [`- ${code(status)} ${paragraphs(r.description)[0] ?? 'no body'}`]
  if (mediaType !== 'application/json') return [`- ${code(status)} ${code(mediaType)}, ${typeOf(media.schema)}`]

  // A named schema is documented once, further down the page.
  const shape = media.schema.$ref ? [] : fields(media.schema, '  ')
  return [`- ${code(status)} ${typeOf(media.schema)}`, ...shape]
}

function renderOperation(method, path, op) {
  const out = [`### ${method.toUpperCase()} ${path}`, '']
  if (op.summary) out.push(op.summary, '')
  for (const p of paragraphs(op.description)) out.push(p, '')

  if (op.parameters?.length) {
    out.push('**parameters**', '')
    for (const p of op.parameters) out.push(renderParam(p))
    out.push('')
  }

  if (op.requestBody) {
    const body = resolve(op.requestBody)
    const [mediaType, media] = Object.entries(body.content ?? {})[0] ?? []
    if (media) {
      out.push('**body**', '')
      out.push(`- ${code(mediaType || 'application/json')} ${typeOf(media.schema)}`)
      if (!media.schema.$ref) out.push(...fields(media.schema, '  '))
      out.push('')
    }
  }

  out.push('**answers**', '')
  for (const [status, response] of Object.entries(op.responses ?? {})) out.push(...renderResponse(status, response))
  out.push('')
  return out
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const byTag = new Map(spec.tags.map((t) => [t.name, []]))
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const op = item[method]
    if (!op) continue
    const tag = op.tags?.[0] || 'misc'
    if (!byTag.has(tag)) byTag.set(tag, [])
    byTag.get(tag).push([method, path, op])
  }
}

const md = [`# ${spec.info.title}`, '']
for (const p of paragraphs(spec.info.description)) md.push(p, '')
md.push(`Base url is ${code(base)}. Most routes are unauthenticated GETs; write routes need a session.`, '')
md.push(`Generated from ${code('server/openapi.yaml')} by ${code('npm run docs:api')}. Edit the spec, not this page.`, '')

md.push('## what is in here', '')
for (const [tag, ops] of byTag) {
  if (!ops.length) continue
  md.push(`- [${tag}](#${slug(tag)}), ${ops.length} route${ops.length === 1 ? '' : 's'}`)
}
// schemas is the one section nothing else links to from up here
md.push(`- [schemas](#${slug('schemas')}), ${Object.keys(spec.components.schemas).length} shapes`)
md.push('')

for (const [tag, ops] of byTag) {
  if (!ops.length) continue
  md.push(`## ${tag}`, '')
  // Jump list for the tag: the route, and what you would find there.
  for (const [method, path, op] of ops) {
    md.push(`- [${code(method.toUpperCase() + ' ' + path)}](#${slug(method.toUpperCase() + ' ' + path)})${op.summary ? ` ${op.summary}` : ''}`)
  }
  md.push('')
  for (const [method, path, op] of ops) md.push(...renderOperation(method, path, op))
}

md.push('## schemas', '')
md.push('The shapes the routes above hand back.', '')
for (const [name, schema] of Object.entries(spec.components.schemas)) {
  md.push(`### ${name}`, '')
  for (const p of paragraphs(schema.description)) md.push(p, '')
  md.push(...fields(schema), '')
}

const doc =
  md
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n'

// Every link above was slugged by hand, so check each one lands on a heading
// this file also wrote, and that no two headings claim the same anchor. A dead
// anchor is worse than no anchor, so stop rather than write the page.
const anchors = new Set()
const twice = []
for (const line of doc.split('\n')) {
  const heading = /^#{1,6} (.+)$/.exec(line)
  if (!heading) continue
  const id = slug(heading[1])
  if (anchors.has(id)) twice.push(id)
  anchors.add(id)
}
const dead = [...doc.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]).filter((id) => !anchors.has(id))
if (dead.length || twice.length) {
  if (dead.length) console.error(`[docs:api] ${dead.length} links point at nothing: ${[...new Set(dead)].join(', ')}`)
  if (twice.length) console.error(`[docs:api] ${twice.length} headings share an anchor: ${[...new Set(twice)].join(', ')}`)
  process.exit(1)
}

writeFileSync(mdPath, doc)

const total = Object.keys(spec.paths).length
const llms = [
  `# ${spec.info.title}`,
  '',
  `> ${total} routes on ${base}, covering ${[...byTag.keys()].filter((t) => byTag.get(t).length).join(', ')}. Most are unauthenticated GET. Handlers answer {"success": true, "<field>": ...}, where the field is plural for a list and singular for one record, and {"success": false} when the lookup misses.`,
  '',
  '## docs',
  '',
  `- [API reference](${base}/api): every route, its parameters and the shape it answers with.`,
  `- [OpenAPI spec](${base}/openapi.yaml): the same thing as OpenAPI 3.1, if you would rather generate a client.`,
  `- [Behaviours](${base}/behaviours): the Lua scripts you attach to a feature inside a parcel.`,
  '',
  '## endpoints',
  '',
]
for (const [tag, ops] of byTag) {
  if (!ops.length) continue
  const detail = blurbs[tag] ? ` ${blurbs[tag]}` : ''
  // Link a route you can actually call, so skip the ones with {placeholders}.
  const example = (ops.find(([, path]) => !path.includes('{')) ?? ops[0])[1]
  llms.push(`- [${tag}](${base}${example}): ${ops.length} route${ops.length === 1 ? '' : 's'}.${detail}`)
}
llms.push('')

writeFileSync(llmsPath, llms.join('\n'))

const linked = [...doc.matchAll(/\]\(#/g)].length
console.log(`[docs:api] ${total} routes, ${Object.keys(spec.components.schemas).length} schemas, ${anchors.size} anchors, ${linked} links to them -> API.md, llms.txt`)
