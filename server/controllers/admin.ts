import { packGround } from '../../common/voxels/ground-bytes'
import { inflateSync } from 'node:zlib'
import type { PoolClient } from 'pg'
import { Express } from 'express'
import rateLimit from 'express-rate-limit'
import { centroid } from '@turf/turf'

import texas from '../../islands/texas/artpack.json'
import cache from '../cache'
import config from '../../common/config'
import { SUPPORTED_CHAINS } from '../../common/helpers/chain-helpers'

import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { requireAdmin } from '../lib/helpers'
import { getContract } from '../lib/utils'
import log from '../lib/logger'
import Parcel from '../parcel'
import ParcelBuilder, { ground } from '../parcel-builder'

function assert(condition: any, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function isInteger(value: any) {
  return typeof value === 'number' && Number.isInteger(value) && isFinite(value)
}

function isFloat(value: any) {
  return typeof value === 'number' && isFinite(value)
}

// DB says minted=false but chain may already have the token. Check exists(),
// flip stale rows to minted=true, return only parcels that are actually unminted.
async function unmintedFromDb(db: Db, page: number) {
  const offset = Math.max(0, page) * 100
  const result = await db.query(
    'sql/get-unminted-parcels',
    `select id, address, island, x1, y1, z1, x2, y2, z2
     from properties
     where minted = false
       and (lower(island) is distinct from 'texas' or is_common is not true)
       and (island is distinct from 'Architect Island' or is_common = true or kind = 'inner')
     order by id desc
     limit 100 offset $1`,
    [offset],
  )
  const rows: any[] = result.rows || []
  if (!rows.length) return { parcels: [], fixed: 0 }

  const contract = await getContract('parcel', SUPPORTED_CHAINS['eth'])
  const stale: number[] = []
  const parcels: any[] = []
  await Promise.all(
    rows.map(async (p) => {
      let exists = false
      try {
        exists = !!(await contract.exists(p.id))
      } catch (e) {
        log.error('unminted exists() failed', { id: p.id, e: String(e) })
      }
      if (exists) stale.push(p.id)
      else parcels.push(p)
    }),
  )

  if (stale.length) {
    await db.query(
      'sql/fix-stale-unminted',
      `update properties
       set minted = true,
           sandbox = true,
           minted_at = coalesce(minted_at, now()),
           updated_at = now()
       where id = any($1::int[])
         and minted = false`,
      [stale],
    )
    log.info('unminted: fixed stale minted flags', { fixed: stale.length, ids: stale })
  }

  // keep original id-desc order
  parcels.sort((a, b) => b.id - a.id)
  return { parcels, fixed: stale.length }
}

export default function AdminController(db: Db, passport: PassportStatic, app: Express) {
  // Get the top parcel id
  app.get('/api/admin/parcels/top', cache(false), async (req, res) => {
    const result = await db.query(
      'sql/get-top-parcel-id',
      `
      select
        id
      from
        properties
      order by
        id desc
      limit 1`,
    )

    const id = result.rows[0].id

    res.status(200).json({ success: true, id })
  })

  // Parcels that exist in the DB but have not been minted on-chain yet.
  // Checks the contract, repairs minted=false rows that are already on-chain, returns only real unminted.
  // Dev proxies prod so local can mint against real parcels without a full DB dump.
  if (config.isDevelopment) {
    app.get('/api/admin/parcels/unminted', cache(false), async (req, res) => {
      const page = String(req.query.page ?? '0')
      try {
        // optional: set PROD_JWT until the no-auth deploy is live
        const headers: Record<string, string> = {}
        if (process.env.PROD_JWT) headers.cookie = `jwt=${process.env.PROD_JWT}`
        const r = await fetch(`https://www.voxels.com/api/admin/parcels/unminted?page=${encodeURIComponent(page)}`, { headers })
        res.status(r.status).json(await r.json())
      } catch (e: any) {
        res.status(502).json({ success: false, message: e?.toString() || 'prod fetch failed' })
      }
    })
  } else {
    app.get('/api/admin/parcels/unminted', cache(false), async (req, res) => {
      const page = parseInt(String(req.query.page ?? '0'), 10)
      try {
        const { parcels, fixed } = await unmintedFromDb(db, isNaN(page) ? 0 : page)
        res.status(200).json({ success: true, parcels, fixed })
      } catch (e: any) {
        log.error('unminted failed', { e: String(e) })
        res.status(500).json({ success: false, message: e?.toString() || 'unminted failed' })
      }
    })
  }

  app.post('/api/admin/parcels/create', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const { id, address, owner, island, x1, y1, z1, x2, y2, z2 } = req.body

    // console.log(JSON.stringify(req.body, null, 2))

    try {
      assert(isFloat(x1) && isFloat(y1) && isFloat(z1) && isFloat(x2) && isFloat(y2) && isFloat(z2), 'Invalid coordinates')
      assert(typeof address === 'string', 'Invalid address')
      assert(isInteger(id), 'Invalid id')
      assert(typeof island === 'string', 'Invalid island')
      assert(typeof owner === 'string', 'Invalid owner')
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message })
      return
    }

    try {
      await createParcelRow(db, { id, address, owner, island, x1, y1, z1, x2, y2, z2, is_common: req.body.is_common === true })
    } catch (e: any) {
      console.log(e)
      res.status(500).json({ success: false, message: e.message })
      return
    }

    res.status(200).json({ success: true })
  })

  const draftAuth = [passport.authenticate('jwt', { session: false }), requireAdmin]
  app.get('/api/admin/island-drafts/:slug', async (req, res) => {
    const r = await db.query('sql/island-draft', 'select settings, content, ground from island_drafts where slug = $1', [req.params.slug])
    res
      .set('Cache-Control', 'no-store')
      .status(r.rows.length ? 200 : 404)
      .json(r.rows[0] ? { ...r.rows[0], ground: r.rows[0].ground && packGround(r.rows[0].ground) } : {})
  })
  app.put('/api/admin/island-drafts/:slug', ...draftAuth, async (req, res) => {
    const { name, count, center, reroll, area, areaSpread, height, heightSpread, atlas, streets, artpack } = req.body
    if (
      !/^[a-z0-9-]{1,100}$/.test(req.params.slug) ||
      typeof name !== 'string' ||
      !name.trim() ||
      !Number.isInteger(count) ||
      count < 1 ||
      !Array.isArray(center) ||
      center.length !== 2 ||
      !center.every(Number.isFinite) ||
      !Number.isInteger(reroll) ||
      ![area, areaSpread, height, heightSpread].every(Number.isFinite) ||
      area < 10 ||
      area > 200 ||
      height < 3 ||
      height > 30 ||
      areaSpread < 0 ||
      areaSpread > 1 ||
      heightSpread < 0 ||
      heightSpread > 1 ||
      typeof streets !== 'string' ||
      typeof atlas !== 'string' ||
      !['', 'texas-thrift'].includes(artpack)
    )
      return res.status(400).json({ message: 'invalid draft settings' })
    const settings = { name, count, center, reroll, area, areaSpread, height, heightSpread, atlas, streets, artpack }
    await db.query(
      'sql/save-island-draft',
      'insert into island_drafts (slug, settings, ground, content) values ($1, $2, $3, $4) on conflict (slug) do update set settings = excluded.settings, ground = excluded.ground, content = excluded.content',
      [req.params.slug, JSON.stringify(settings), floorBytes(req.body.ground), req.body.content || {}],
    )
    res.json({ success: true })
  })

  // Upsert island
  app.post('/api/admin/islands', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const { name, geometry, content } = req.body
    try {
      await upsertIsland(db, name, geometry, content, req.body.ground, req.body.lakes)
    } catch (e: any) {
      console.log(e)
      res.status(500).json({ success: false, message: e.toString() })
      return
    }
    res.status(200).json({ success: true })
  })

  // Village autobuild from /admin island: the island, then every parcel with its voxels
  app.post('/api/admin/islands/build', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const { name, geometry, content, parcels, atlas } = req.body
    if (!validIslandBody(req.body)) {
      res.status(400).json({ success: false, message: 'Need a name and parcels' })
      return
    }

    // leave 20m of sea round the island
    const xs = parcels.flatMap((p: any) => [m(p.x1), m(p.x2)])
    const zs = parcels.flatMap((p: any) => [m(p.z1), m(p.z2)])
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query('lock table islands in share row exclusive mode')
      const r = await db.query(
        'sql/admin-island-overlap',
        `select count(*)::int as n from properties where island is distinct from $1 and bounds && cube(ARRAY[$2::float8,-1000,$3::float8], ARRAY[$4::float8,1000,$5::float8])`,
        [name, Math.min(...xs) - 20, Math.min(...zs) - 20, Math.max(...xs) + 20, Math.max(...zs) + 20],
        client,
      )
      if (r.rows[0]?.n) {
        await client.query('ROLLBACK')
        res.status(400).json({ success: false, message: `${r.rows[0].n} parcels already there, move the center` })
        return
      }

      await upsertIsland(db, name, geometry, content, req.body.ground, req.body.lakes, client)
      const suburbs = new Map<string, number>()
      for (const row of villageRows(name, parcels, atlas, req.body.artpack)) {
        if (row.suburb && !suburbs.has(row.suburb)) {
          const found = await client.query('select id from suburbs where name = $1 order by id limit 1', [row.suburb])
          const suburb = found.rows[0] || (await client.query('insert into suburbs (name) values ($1) returning id', [row.suburb])).rows[0]
          suburbs.set(row.suburb, suburb.id)
        }
        const inserted = await createParcelRow(db, { ...row, suburbId: suburbs.get(row.suburb) }, client)
        if (!inserted.rowCount) throw new Error('parcel id already exists: ' + row.id)
      }
      await client.query('COMMIT')
    } catch (e: any) {
      await client.query('ROLLBACK')
      log.error('island build failed', { e: String(e) })
      res.status(500).json({ success: false, message: e?.toString() || 'build failed' })
      return
    } finally {
      client.release()
    }
    res.status(200).json({ success: true, inserted: parcels.length })
  })

  // Same build, nothing written: the world client loads this when opened with ?preview=1 so you can fly round the proposal
  app.post('/api/admin/islands/preview', rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
    const { name, geometry, parcels, atlas } = req.body
    if (!validIslandBody(req.body)) {
      res.status(400).json({ success: false, message: 'Need a name and parcels' })
      return
    }
    // Each house allocates a dense voxel field on the server.
    let volume = 0
    if (
      parcels.length > 4096 ||
      !parcels.every((p: any) => {
        if (!p) return false
        const sides = [m(p.x2) - m(p.x1), p.y2 - p.y1, m(p.z2) - m(p.z1)]
        if (!sides.every((v) => Number.isSafeInteger(v) && v > 0 && v <= 256)) return false
        volume += sides[0] * sides[1] * sides[2]
        return volume <= 4_000_000
      })
    )
      return res.status(400).json({ success: false, message: 'Preview exceeds parcel dimensions or volume limit' })
    let position = {}
    try {
      position = centroid(geometry).geometry
    } catch {}
    const none = { type: 'MultiPolygon', coordinates: [] }
    res.json({
      success: true,
      // 40 and up renders every ring, the clusters of a village are often separate blobs
      island: {
        id: 40,
        name,
        other_name: null,
        texture: req.body.ground ? texas.ground : '',
        ground: req.body.ground,
        content: { origin: req.body.content?.origin, features: req.body.content?.features, streets: req.body.content?.streets },
        position,
        geometry,
        holes_geometry_json: none,
        lakes_geometry_json: req.body.lakes || none,
      },
      parcels: villageRows(name, parcels, atlas, req.body.artpack).map(
        (r) => new Parcel({ ...r, x1: m(r.x1), x2: m(r.x2), z1: m(r.z1), z2: m(r.z2), height: r.y2 - r.y1, hash: 'preview', visible: true, settings: {}, parcel_users: [] }).summary,
      ),
    })
  })

  app.get('/api/admin/sandboxes/suggest', cache(false), passport.authenticate('jwt', { session: false }), requireAdmin, async (_req, res) => {
    try {
      const r = await db.query(
        'sql/admin-sandbox-suggest',
        `select id, address, name, island, sandbox
         from properties
         where minted = true
           and island = 'Obscurity'
           and lower(owner) = lower($1)
           and sandbox = false
         order by id
         limit 100`,
        [TREASURY],
      )
      res.json({ success: true, parcels: r.rows })
    } catch (e: any) {
      log.error('sandbox suggest failed', { e: String(e) })
      res.status(500).json({ success: false })
    }
  })

  app.post('/api/admin/parcels/:id/sandbox', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'bad id' })
      return
    }
    const sandbox = !!req.body?.sandbox
    try {
      const parcel = await Parcel.load(id)
      if (!parcel) {
        res.status(404).json({ success: false, error: 'not found' })
        return
      }
      parcel.sandbox = sandbox
      await parcel.save()
      parcel.broadcastMeta()
      res.json({ success: true, sandbox })
    } catch (e: any) {
      log.error('admin sandbox toggle failed', { e: String(e) })
      res.status(500).json({ success: false, error: e?.toString?.() || 'failed' })
    }
  })

  app.post('/api/admin/chat/:id/nerf', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const id = req.params.id
    if (!id) {
      res.status(400).json({ success: false })
      return
    }
    try {
      const r = await db.query('admin/chat-nerf', `UPDATE chat_messages SET moderated_at = now() WHERE id = $1`, [id])
      if (!r.rowCount) {
        res.status(404).json({ success: false })
        return
      }
      res.json({ success: true })
    } catch (e: any) {
      log.error('chat nerf failed', { e: String(e) })
      res.status(500).json({ success: false })
    }
  })
}

const TREASURY = '0x36F1A7f48f4e7bbda9E2d8aEEfEE639cae2604bc'

// bounds are in metres, geo coords * 100
const m = (v: number) => Math.round(v * 100)

function validIslandBody(b: any) {
  return typeof b?.name === 'string' && b.name && Array.isArray(b.parcels) && b.parcels.length
}

// designer parcels -> parcel rows with their village house voxels, all on the one tileset if given
function villageRows(name: string, parcels: any[], atlas?: string, artpack?: string) {
  const pack = artpack === 'texas-thrift' ? texas : undefined
  const tileset = pack?.atlas || (typeof atlas === 'string' && atlas ? atlas : undefined)
  return parcels.map((p, i) => {
    const shape = { x1: m(p.x1), x2: m(p.x2), z1: m(p.z1), z2: m(p.z2), y1: p.y1, y2: p.y2, height: p.y2 - p.y1, common: p.is_common && p.common }
    const house = ParcelBuilder.Village(shape, isInteger(p.material) ? p.material : ground, p.door, !!pack, i)
    return { ...p, island: name, content: { ...house, tileset } }
  })
}

async function createParcelRow(
  db: Db,
  p: { id: number; address: string; owner: string; island: string; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; kind?: string; is_common?: boolean; content?: any; suburbId?: number },
  client?: PoolClient,
) {
  const { id, address, owner, island, x1, y1, z1, x2, y2, z2 } = p
  const minX = Math.min(x1, x2)
  const maxX = Math.max(x1, x2)
  const minZ = Math.min(z1, z2)
  const maxZ = Math.max(z1, z2)
  const x1c = Math.round(minX * 100)
  const x2c = Math.round(maxX * 100)
  const z1c = Math.round(minZ * 100)
  const z2c = Math.round(maxZ * 100)
  const ring = [
    [minX, minZ],
    [minX, maxZ],
    [maxX, maxZ],
    [maxX, minZ],
    [minX, minZ],
  ]
  const geometry_json = JSON.stringify({ type: 'Polygon', crs: { type: 'name', properties: { name: 'EPSG:3857' } }, coordinates: [ring] })
  const settings = '{}'
  return db.query(
    'sql/create-parcel',
    `
      INSERT INTO
        properties (id, address, owner, y1, y2, geometry_json, x1, x2, z1, z2, bounds, visible, island, kind, settings, minted, is_common, content, suburb_id)
      VALUES
        ($1, $2, $3, $4::float8, $5::float8, $6::jsonb, $7::float8, $8::float8, $9::float8, $10::float8, cube(ARRAY[$7::float8,$4::float8,$9::float8], ARRAY[$8::float8,$5::float8,$10::float8]), true, $11, $13, $12::jsonb, false, $14, $15::json, $16)
      ON CONFLICT (id) DO NOTHING
    `,
    [id, address, owner, y1, y2, geometry_json, x1c, x2c, z1c, z2c, island, settings, p.kind || 'plot', !!p.is_common, p.content ? JSON.stringify(p.content) : null, p.suburbId || null],
    client,
  )
}

function floorBytes(value: unknown) {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('invalid ground')
  const bytes = value.startsWith('z:') ? inflateSync(Buffer.from(value.slice(2), 'base64'), { maxOutputLength: 64 * 1024 * 1024 }) : Buffer.from(value, 'base64')
  if (bytes.length < 16) throw new Error('invalid ground header')
  const width = bytes.readInt32LE(8),
    depth = bytes.readInt32LE(12)
  if (width < 1 || depth < 1 || ![width * depth, width * depth * 8, width * depth * 16].includes(bytes.length - 16)) throw new Error('invalid ground dimensions')
  return bytes
}

async function upsertIsland(db: Db, name: string, geometry: any, content: any, ground?: string, lakes?: any, client?: PoolClient) {
  const geomStr = JSON.stringify(geometry)
  let position_json = '{}'
  try {
    position_json = JSON.stringify(centroid(JSON.parse(geomStr) as any).geometry)
  } catch {
    // todo: invalid geometry from the designer
  }
  await db.query(
    'sql/upsert-island',
    `
      WITH upsert AS (
        UPDATE islands SET geometry_json = $2::jsonb, position_json = $4::jsonb, content = $3, ground = $5, lakes_geometry_json = coalesce($7::jsonb, lakes_geometry_json), texture = coalesce($6, texture) WHERE name = $1 RETURNING *
      )
      INSERT INTO islands (name, geometry_json, content, position_json, ground, texture, lakes_geometry_json)
      SELECT $1, $2::jsonb, $3, $4::jsonb, $5, coalesce($6, ''), $7::jsonb WHERE NOT EXISTS (SELECT 1 FROM upsert);
    `,
    [name, geomStr, content, position_json, floorBytes(ground), ground ? texas.ground : null, lakes ? JSON.stringify(lakes) : null],
    client,
  )
}
