import type Parcel from './parcel'

const id = Number(new URLSearchParams(location.search).get('parcel'))
const key = 'skynet:' + id
const fragment = new URLSearchParams(location.hash.slice(1)).get('skynet')
if (fragment) {
  sessionStorage.setItem(key, fragment)
  history.replaceState(history.state, '', location.pathname + location.search)
}

let current: Parcel | undefined
async function parcel() {
  const p = window.grid?.getByID(id)
  if (!p?.loaded) throw Error('Waiting for parcel ' + id)
  // The world index may still refer to an immutable pack from before the last save.
  if (p !== current) {
    await p.reload()
    current = p
  }
  return p
}

const point = { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 }
const positions = { type: 'array', items: point, minItems: 1, maxItems: 128 }
const api = {
  async get_parcel() {
    const p = await parcel()
    return { id, name: p.name, shape: p.fieldShape }
  },
  async read_voxels({ positions }: { positions: [number, number, number][] }) {
    const p = await parcel()
    if (!Array.isArray(positions) || positions.length < 1 || positions.length > 128 || !positions.every((v) => Array.isArray(v) && v.length === 3 && v.every((n, i) => Number.isInteger(n) && n >= 0 && n < p.fieldShape[i])))
      throw Error('Expected 1-128 in-bounds [x,y,z] positions')
    return positions.map((v) => p.field?.get(...v) ?? 0)
  },
  async set_voxels(input: { positions: [number, number, number][]; value: number }) {
    await parcel()
    const r = await fetch(`/api/parcels/${id}/skynet/voxels`, { method: 'POST', credentials: 'omit', headers: { Authorization: 'Bearer ' + sessionStorage.getItem(key), 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    current = undefined
    if (!r.ok) throw Error('Save failed: ' + r.status)
    return r.json()
  },
}
;(window as any).skynet = api
const mc = (navigator as any).modelContext ?? (document as any).modelContext
function register(name: keyof typeof api, description: string, properties: object) {
  mc?.registerTool({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties) }, execute: async (args: any) => ({ content: [{ type: 'text', text: JSON.stringify(await api[name](args)) }] }) })
}
register('get_parcel', 'Get the linked parcel and its voxel dimensions.', {})
register('read_voxels', 'Read block values at parcel-local [x,y,z] positions in order.', { positions })
register('set_voxels', 'Set up to 128 blocks to one value (0 is air). Returns after saving.', { positions, value: { type: 'integer', minimum: 0, maximum: 65535 } })
