import { v7 as uuid } from 'uuid'
import { contentName } from '../../common/helpers/ugc-upload-keys'
import { uploadParcelBytes } from '../../common/helpers/upload-media'
import { getVoxelsFromBuffer } from '../../common/voxels/helpers'
import { currentVersion } from '../../common/version'
import ParcelBudget, { featureBudget } from '../parcel-budget'
import type Parcel from '../parcel'

// WebMCP shape. execute returns plain JSON, or { mimeType, base64 } for images
export type Tool = { name: string; description: string; inputSchema: any; execute: (input: any) => any }
type Point = [number, number, number]

const registry = new Map<string, Tool>()

export function registerTool(tool: Tool) {
  registry.set(tool.name, tool)
  expose(tool)
}

function expose(tool: Tool) {
  const mc = (document as any).modelContext ?? (navigator as any).modelContext
  try {
    mc?.registerTool?.({ ...tool, execute: async (input: any) => content(await tool.execute(input ?? {})) })
  } catch (e) {
    console.error('[skynet] modelContext.registerTool failed', e)
  }
}

export function tools() {
  return [...registry.values()]
}

// MCP tool result content
export function content(result: any) {
  if (result?.mimeType && result?.base64) return { content: [{ type: 'image', data: result.base64, mimeType: result.mimeType }] }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

// the parcel this browser's skynet token edits, read from the jwt cookie
export function home(): number | undefined {
  try {
    const jwt = document.cookie.match(/(?:^|; )jwt=([^;]+)/)?.[1]
    return JSON.parse(atob(decodeURIComponent(jwt!).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).parcel_id
  } catch {
    return undefined
  }
}

function loaded(id = home()): Parcel {
  if (!id) throw new Error('Which parcel? Pass id.')
  const p = window.grid?.getByID(id)
  if (!p?.loaded) throw new Error(`Parcel ${id} is not loaded. Stand near it.`)
  return p
}

function editable(id = home()): Parcel {
  const p = loaded(id)
  if (!p.canEdit) throw new Error(`You can't edit parcel ${id}. Log in as the owner or a collaborator.`)
  if (!p.sandbox && !window.grid?.isOpen) throw new Error('Grid socket is closed. Writes would not save.')
  return p
}

function field(p: Parcel) {
  if (!p.field) p.loadField()
  if (!p.field) throw new Error('Parcel has no voxel field.')
  return p.field
}

function inside(v: any, shape: number[]): v is Point {
  return Array.isArray(v) && v.length === 3 && v.every((n, i) => Number.isInteger(n) && n >= 0 && n < shape[i])
}

function corners(op: any, shape: number[]): [Point, Point] {
  if (!inside(op.from, shape) || !inside(op.to, shape)) throw new Error(`from/to must be integer [x,y,z] inside shape ${JSON.stringify(shape)}`)
  const lo = op.from.map((n: number, i: number) => Math.min(n, op.to[i])) as Point
  const hi = op.from.map((n: number, i: number) => Math.max(n, op.to[i])) as Point
  return [lo, hi]
}

function* box([lo, hi]: [Point, Point], hollow = false): Generator<Point> {
  for (let x = lo[0]; x <= hi[0]; x++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let z = lo[2]; z <= hi[2]; z++) {
        if (hollow && x > lo[0] && x < hi[0] && y > lo[1] && y < hi[1] && z > lo[2] && z < hi[2]) continue
        yield [x, y, z]
      }
}

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
const parcelId = { type: 'integer', description: 'Parcel id. Defaults to the parcel your skynet token edits.' }

registerTool({
  name: 'health',
  description: 'Call first. Is the grid socket open, who is logged in, which loaded parcels can be edited.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => ({
    grid: !!window.grid?.isOpen,
    wallet: window.user?.wallet ?? null,
    parcel: home() ?? null,
    editable: [...(window.grid?.parcels.values() || [])].filter((p) => p.loaded && p.canEdit).map((p) => ({ id: p.id, name: p.name ?? null })),
    version: currentVersion,
  }),
})

registerTool({
  name: 'get_parcel',
  description: 'Parcel shape, bounds, tileset, palette, edit rights, feature counts and remaining feature budget.',
  inputSchema: { type: 'object', properties: { id: parcelId }, required: [] },
  execute: ({ id }) => {
    const p = loaded(id)
    const features: Record<string, number> = {}
    for (const f of p.featuresList) features[f.type] = (features[f.type] || 0) + 1
    const budget: Record<string, number> = {}
    for (const type of Object.keys(featureBudget) as any[]) budget[type] = ParcelBudget.budget(type, p) - p.budget.count(type)
    return {
      id: p.id,
      name: p.name ?? null,
      shape: p.fieldShape,
      bounds: [p.boundingBox.minimumWorld.asArray(), p.boundingBox.maximumWorld.asArray()],
      tileset: p.tileset ?? null,
      palette: p.palette ?? null,
      canEdit: p.canEdit,
      sandbox: p.sandbox,
      features,
      budget,
    }
  },
})

registerTool({
  name: 'read_voxels',
  description: 'Read the voxel field. layer: one y slice as rows[x][z]. from/to: inclusive region as run-length [value, count] in x,y,z order (z fastest). Always returns a census of value -> count.',
  inputSchema: { type: 'object', properties: { id: parcelId, layer: { type: 'integer' }, from: vec3, to: vec3 }, required: [] },
  execute: ({ id, layer, from, to }) => {
    const p = loaded(id)
    const f = field(p)
    const shape = p.fieldShape
    const census: Record<number, number> = {}
    if (layer !== undefined) {
      if (!Number.isInteger(layer) || layer < 0 || layer >= shape[1]) throw new Error(`layer must be 0-${shape[1] - 1}`)
      const rows: number[][] = []
      for (let x = 0; x < shape[0]; x++) {
        const row: number[] = []
        for (let z = 0; z < shape[2]; z++) {
          const v = f.get(x, layer, z)
          census[v] = (census[v] || 0) + 1
          row.push(v)
        }
        rows.push(row)
      }
      return { shape, layer, rows, census }
    }
    const region = from || to ? corners({ from, to }, shape) : ([[0, 0, 0], shape.map((n) => n - 1)] as [Point, Point])
    const runs: [number, number][] = []
    for (const v of box(region)) {
      const value = f.get(...v)
      census[value] = (census[value] || 0) + 1
      const last = runs[runs.length - 1]
      if (last?.[0] === value) last[1]++
      else runs.push([value, 1])
    }
    return { shape, from: region[0], to: region[1], runs, census }
  },
})

registerTool({
  name: 'set_voxels',
  description: 'Write voxels. ops run in order: box (fill from..to), hollow_box (shell of from..to), carve (from..to to air), positions (list of [x,y,z]). Waits for the server to save. Returns { saved, changed }.',
  inputSchema: {
    type: 'object',
    properties: {
      id: parcelId,
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: { op: { enum: ['box', 'hollow_box', 'carve', 'positions'] }, from: vec3, to: vec3, positions: { type: 'array', items: vec3 }, value: { type: 'integer', description: 'uint16 block value, 0 is air' } },
          required: ['op'],
        },
      },
    },
    required: ['ops'],
  },
  execute: async ({ id, ops }) => {
    const p = editable(id)
    const f = field(p)
    const shape = p.fieldShape
    // validate everything before touching the field
    const plan: [Iterable<Point>, number][] = (ops || []).map((op: any) => {
      const value = op.op === 'carve' ? 0 : op.value
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('value must be a uint16 block value')
      if (op.op === 'box' || op.op === 'carve' || op.op === 'hollow_box') return [[...box(corners(op, shape), op.op === 'hollow_box')], value]
      if (op.op === 'positions') {
        if (!Array.isArray(op.positions) || !op.positions.every((v: any) => inside(v, shape))) throw new Error(`positions must be integer [x,y,z] inside shape ${JSON.stringify(shape)}`)
        return [op.positions, value]
      }
      throw new Error(`unknown op ${op.op}`)
    })
    // only changed voxels go over the wire, one patch per value
    const byValue = new Map<number, Point[]>()
    let changed = 0
    for (const [points, value] of plan)
      for (const v of points) {
        if (f.get(...v) === value) continue
        f.set(...v, value)
        changed++
        if (!byValue.has(value)) byValue.set(value, [])
        byValue.get(value)!.push(v)
      }
    p.voxels = getVoxelsFromBuffer(f.data.buffer)
    p.generate()
    if (!changed || p.sandbox) return { saved: !p.sandbox, changed, sandbox: p.sandbox }
    const writes: Promise<void>[] = []
    for (const [value, positions] of byValue) for (let i = 0; i < positions.length; i += 8192) writes.push(p.sendPatch({ voxels: { positions: positions.slice(i, i + 8192), value } }, true))
    try {
      await Promise.all(writes)
    } catch (e: any) {
      // local field is ahead of the server now, resync before reporting
      await p.reload().catch(() => {})
      throw new Error(`Not saved: ${e.message}. Parcel reloaded from server.`)
    }
    return { saved: true, changed }
  },
})

registerTool({
  name: 'list_features',
  description: 'All feature records in the parcel (uuid, type, position, rotation, scale and type specific props). Positions are parcel-local metres.',
  inputSchema: { type: 'object', properties: { id: parcelId }, required: [] },
  execute: ({ id }) => loaded(id).featuresList.map((f) => f.description),
})

registerTool({
  name: 'add_feature',
  description: 'Add a feature (vox-model, image, sign, polytext, lantern, ...). position is parcel-local metres from the parcel centre at ground level. props are type specific (url, text, color...). Waits for the save. Returns the record.',
  inputSchema: {
    type: 'object',
    properties: { id: parcelId, type: { type: 'string' }, position: vec3, rotation: vec3, scale: vec3, props: { type: 'object' } },
    required: ['type', 'position'],
  },
  execute: async ({ id, type, position, rotation, scale, props }) => {
    const p = editable(id)
    if (!(type in featureBudget)) throw new Error(`unknown feature type ${type}. Known: ${Object.keys(featureBudget).join(', ')}`)
    if (!p.budget.hasBudgetFor(type)) throw new Error(`${type} is over budget for this parcel`)
    const record: any = { ...props, uuid: uuid(), type, position, rotation: rotation || [0, 0, 0], scale: scale || [1, 1, 1] }
    await p.sendPatch({ features: { [record.uuid]: record } }, true)
    p.features.push(record)
    await p.createFeature(record).catch((e) => console.error('[skynet] saved but could not render', e))
    return record
  },
})

registerTool({
  name: 'update_feature',
  description: 'Merge a partial record into a feature (position, rotation, scale, url, text...). Waits for the save.',
  inputSchema: { type: 'object', properties: { id: parcelId, uuid: { type: 'string' }, patch: { type: 'object' } }, required: ['uuid', 'patch'] },
  execute: async ({ id, uuid, patch }) => {
    const p = editable(id)
    const f = p.getFeatureByUuid(uuid)
    if (!f) throw new Error(`no feature ${uuid}`)
    const { type: _type, uuid: _uuid, ...rest } = patch || {}
    await p.sendPatch({ features: { [uuid]: rest } }, true)
    Object.assign(p.features.find((r) => r?.uuid === uuid) || {}, rest)
    f.update(rest)
    return f.description
  },
})

registerTool({
  name: 'remove_feature',
  description: 'Delete a feature. Waits for the save.',
  inputSchema: { type: 'object', properties: { id: parcelId, uuid: { type: 'string' } }, required: ['uuid'] },
  execute: async ({ id, uuid }) => {
    const p = editable(id)
    const f = p.getFeatureByUuid(uuid)
    if (!f) throw new Error(`no feature ${uuid}`)
    await p.sendPatch({ features: { [uuid]: null } }, true)
    f.budgetUnconsume()
    f.dispose()
    return { removed: uuid }
  },
})

registerTool({
  name: 'search_assets',
  description: 'Search the shared asset library (vox models, images...). Use a result url as a feature url prop.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' }, page: { type: 'integer' } }, required: ['query'] },
  execute: async ({ query, page }) => {
    const params = new URLSearchParams({ q: query, page: String(page || 0), limit: '20', sort: 'views', asc: 'false' })
    return (await fetch(`/api/library/all.json?${params}`)).json()
  },
})

registerTool({
  name: 'upload_vox',
  description: 'Upload a MagicaVoxel .vox file (base64) to the parcel content store. Returns { url } for a vox-model feature.',
  inputSchema: { type: 'object', properties: { id: parcelId, base64: { type: 'string' } }, required: ['base64'] },
  execute: async ({ id, base64 }) => {
    const p = editable(id)
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    if (String.fromCharCode(...bytes.slice(0, 4)) !== 'VOX ') throw new Error('not a .vox file')
    const r = await uploadParcelBytes(p.id as number, (await contentName(bytes)) + '.vox', bytes, 'application/octet-stream')
    if (!r.success) throw new Error(r.error || 'upload failed')
    return { url: r.location }
  },
})

async function post(url: string, method: string, body: any) {
  const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json().catch(() => ({ success: false, error: `HTTP ${r.status}` }))
}

registerTool({
  name: 'snapshot',
  description: 'Save the current saved state of the parcel as a named snapshot. Owner only. Returns { version } for revert.',
  inputSchema: { type: 'object', properties: { id: parcelId, name: { type: 'string' } }, required: ['name'] },
  execute: async ({ id, name }) => {
    const r = await post('/api/parcels/snapshot', 'POST', { parcel_id: editable(id).id })
    if (!r.success || !r.id) throw new Error(r.message || r.error || 'snapshot failed')
    await post('/api/parcels/snapshot', 'PUT', { version: { id: r.id }, name })
    return { version: r.id, name }
  },
})

registerTool({
  name: 'revert',
  description: 'Restore the parcel to a snapshot version and reload it.',
  inputSchema: { type: 'object', properties: { id: parcelId, version: { type: 'integer' } }, required: ['version'] },
  execute: async ({ id, version }) => {
    const p = editable(id)
    const r = await post(`/api/parcels/${p.id}/revert`, 'POST', { parcel_version_id: version })
    if (!r.success) throw new Error(r.error || 'revert failed')
    await p.reload()
    return { reverted: version }
  },
})

registerTool({
  name: 'screenshot',
  description: 'Fallback only: if you can screenshot your own browser, do that instead. Renders the parcel from a framed camera: top | iso | front (front looks north from the south side). For looks, verify geometry with read_voxels.',
  inputSchema: {
    type: 'object',
    properties: { id: parcelId, preset: { enum: ['top', 'iso', 'front'] }, fov: { type: 'number', description: 'degrees, default 60' }, size: { type: 'integer', description: 'pixels, default 768, max 2048' } },
    required: [],
  },
  execute: async ({ id, preset, fov, size }) => {
    const p = loaded(id)
    const scene = window.scene
    if (!scene) throw new Error('no scene')
    const bb = p.boundingBox
    const center = bb.centerWorld.clone()
    const angle = ((Math.min(120, Math.max(10, fov || 60)) * Math.PI) / 180) as number
    const distance = bb.extendSizeWorld.length() / Math.sin(angle / 2)
    const dir = preset === 'top' ? new BABYLON.Vector3(0, 1, -0.001) : preset === 'front' ? new BABYLON.Vector3(0, 0.25, -1) : new BABYLON.Vector3(1, 0.9, -1)
    const camera = new BABYLON.TargetCamera('skynet-shot', center.add(dir.normalize().scale(distance)), scene, false)
    try {
      camera.fov = angle
      camera.minZ = 0.1
      camera.maxZ = distance * 4
      camera.setTarget(center)
      const px = Math.min(2048, Math.max(64, size || 768))
      const url = await BABYLON.ScreenshotTools.CreateScreenshotUsingRenderTargetAsync(scene.getEngine(), camera, px, 'image/png')
      return { mimeType: 'image/png', base64: url.slice(url.indexOf(',') + 1) }
    } finally {
      camera.dispose()
    }
  },
})
