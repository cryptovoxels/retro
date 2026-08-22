import { Express } from 'express'
import { centroid } from '@turf/turf'

import cache from '../cache'
import config from '../../common/config'
import { SUPPORTED_CHAINS } from '../../common/helpers/chain-helpers'

import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { requireAdmin, isValidUUID } from '../lib/helpers'
import { getContract } from '../lib/utils'
import log from '../lib/logger'
import Parcel from '../parcel'
import { VoxelsUserRequest } from '../user'

const SPACE_IMPORT_ID_MIN = 69000
const SPACE_IMPORT_ID_MAX = 69420
// far ocean dump spot; each free id steps east by 5 degrees (500m)
const SPACE_IMPORT_ORIGIN: [number, number] = [40, 40]
const SPACE_IMPORT_STEP = 5

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
       and space_id is null
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
      await createParcelRow(db, { id, address, owner, island, x1, y1, z1, x2, y2, z2 })
    } catch (e: any) {
      console.log(e)
      res.status(500).json({ success: false, message: e.message })
      return
    }

    res.status(200).json({ success: true })
  })

  // Upsert island
  app.post('/api/admin/islands', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const { name, geometry, content } = req.body
    try {
      await upsertIsland(db, name, geometry, content)
    } catch (e: any) {
      console.log(e)
      res.status(500).json({ success: false, message: e.toString() })
      return
    }
    res.status(200).json({ success: true })
  })

  // Mint a space onto the map as a temporary unminted parcel + island
  app.post('/api/admin/islands/import', passport.authenticate('jwt', { session: false }), requireAdmin, async (req: VoxelsUserRequest, res) => {
    const spaceId = typeof req.body?.space_id === 'string' ? req.body.space_id : typeof req.body?.space === 'string' ? req.body.space : null
    if (!spaceId || !isValidUUID(spaceId)) {
      res.status(400).json({ success: false, message: 'invalid space id' })
      return
    }

    const wallet = req.user?.wallet
    if (!wallet) {
      res.status(401).json({ success: false, message: 'no wallet' })
      return
    }

    try {
      const existing = await db.query(
        'sql/space-import-existing',
        `select s.id, s.parcel_id, s.name, s.width, s.height, s.depth, s.description, s.content,
                p.id as property_id
         from spaces s
         left join properties p on p.id = s.parcel_id
         where s.id = $1`,
        [spaceId],
      )
      const space = existing.rows[0]
      if (!space) {
        res.status(404).json({ success: false, message: 'space not found' })
        return
      }

      if (space.parcel_id && space.property_id) {
        res.status(200).json({ success: true, parcel_id: space.parcel_id, existing: true })
        return
      }

      const free = await db.query(
        'sql/space-import-free-id',
        `select gs as id
         from generate_series($1, $2) gs
         where not exists (select 1 from properties where id = gs)
         order by gs
         limit 1`,
        [SPACE_IMPORT_ID_MIN, SPACE_IMPORT_ID_MAX],
      )
      const id = free.rows[0]?.id
      if (!id) {
        res.status(400).json({ success: false, message: 'no free ids in 69000-69420' })
        return
      }

      const width = Number(space.width) || 8
      const height = Number(space.height) || 8
      const depth = Number(space.depth) || 8
      const slot = id - SPACE_IMPORT_ID_MIN
      const ox = SPACE_IMPORT_ORIGIN[0] + slot * SPACE_IMPORT_STEP
      const oz = SPACE_IMPORT_ORIGIN[1]
      const halfW = width / 200
      const halfD = depth / 200
      const x1 = ox - halfW
      const x2 = ox + halfW
      const z1 = oz - halfD
      const z2 = oz + halfD
      const y1 = 0
      const y2 = height

      let islandName = (space.name && String(space.name).trim()) || `space-${id}`
      const nameTaken = await db.query('sql/space-import-island-exists', `select 1 from islands where name = $1 limit 1`, [islandName])
      if (nameTaken.rows[0]) islandName = `${islandName} ${id}`

      const ring = [
        [x1, z1],
        [x1, z2],
        [x2, z2],
        [x2, z1],
        [x1, z1],
      ]
      const geometry = { type: 'Polygon', crs: { type: 'name', properties: { name: 'EPSG:3857' } }, coordinates: [ring] }

      await upsertIsland(db, islandName, geometry, {})
      await createParcelRow(db, {
        id,
        address: `1 ${islandName}`,
        owner: wallet,
        island: islandName,
        x1,
        y1,
        z1,
        x2,
        y2,
        z2,
      })

      await db.query(
        'sql/space-import-fill',
        `update properties
         set content = $2::json,
             name = $3,
             description = $4,
             space_id = $5,
             expires_at = now() + interval '7 days',
             visible = true,
             minted = false,
             updated_at = now()
         where id = $1`,
        [id, JSON.stringify(space.content || {}), space.name || islandName, space.description || null, spaceId],
      )

      await db.query('sql/space-import-link', `update spaces set parcel_id = $2 where id = $1`, [spaceId, id])

      res.status(200).json({ success: true, parcel_id: id, island: islandName, existing: false })
    } catch (e: any) {
      log.error('space import failed', { e: String(e) })
      res.status(500).json({ success: false, message: e?.toString?.() || 'failed' })
    }
  })

  const TREASURY = '0x36F1A7f48f4e7bbda9E2d8aEEfEE639cae2604bc'

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
}

async function createParcelRow(db: Db, p: { id: number; address: string; owner: string; island: string; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }) {
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
  await db.query(
    'sql/create-parcel',
    `
      INSERT INTO
        properties (id, address, owner, y1, y2, geometry_json, x1, x2, z1, z2, bounds, visible, island, kind, settings, minted)
      VALUES
        ($1, $2, $3, $4::float8, $5::float8, $6::jsonb, $7::float8, $8::float8, $9::float8, $10::float8, cube(ARRAY[$7::float8,$4::float8,$9::float8], ARRAY[$8::float8,$5::float8,$10::float8]), true, $11, 'plot', $12::jsonb, false)
      ON CONFLICT (id) DO NOTHING
    `,
    [id, address, owner, y1, y2, geometry_json, x1c, x2c, z1c, z2c, island, settings],
  )
}

async function upsertIsland(db: Db, name: string, geometry: any, content: any) {
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
        UPDATE islands SET geometry_json = $2::jsonb, position_json = $4::jsonb, content = $3 WHERE name = $1 RETURNING *
      )
      INSERT INTO islands (name, geometry_json, content, position_json, holes_geometry_json, lakes_geometry_json)
      SELECT $1, $2::jsonb, $3, $4::jsonb, '{}'::jsonb, '{}'::jsonb WHERE NOT EXISTS (SELECT 1 FROM upsert);
    `,
    [name, geomStr, content, position_json],
  )
}
