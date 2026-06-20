import { Express } from 'express'
import { centroid } from '@turf/turf'

import cache from '../cache'

import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { requireAdmin } from '../lib/helpers'

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
  app.get('/api/admin/parcels/unminted', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const page = parseInt(String(req.query.page ?? '0'), 10)
    const offset = (isNaN(page) ? 0 : Math.max(0, page)) * 100
    const result = await db.query(
      'sql/get-unminted-parcels',
      `select id, address, island, x1, y1, z1, x2, y2, z2
       from properties
       where minted = false
       order by id desc
       limit 100 offset $1`,
      [offset],
    )
    res.status(200).json({ success: true, parcels: result.rows })
  })

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
      await createParcelRow(db, { id, address, owner, island, x1, y1, z1, x2, y2, z2 }, false)
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

  // Anyone signed in can propose an island. Lands in island_proposals as 'pending'.
  app.post('/api/islands/propose', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const proposer = (req.user as any)?.wallet
    if (!proposer) {
      res.status(401).json({ success: false })
      return
    }
    const { name, geometry, content, parcels } = req.body
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, message: 'name required' })
      return
    }
    try {
      await db.query(
        'sql/insert-island-proposal',
        `insert into island_proposals (proposer, name, geometry_json, content, parcels)
         values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
        [proposer, name, JSON.stringify(geometry ?? null), JSON.stringify(content ?? null), JSON.stringify(parcels ?? [])],
      )
    } catch (e: any) {
      console.log(e)
      res.status(500).json({ success: false, message: e.toString() })
      return
    }
    res.status(200).json({ success: true })
  })

  app.get('/api/admin/island-proposals', passport.authenticate('jwt', { session: false }), requireAdmin, async (_req, res) => {
    const result = await db.query('sql/get-island-proposals', `select id, proposer, name, parcels, status, created_at from island_proposals where status = 'pending' order by id desc`)
    res.status(200).json({ success: true, proposals: result.rows })
  })

  // Accept: write the island + drop its parcels into the db in sandbox mode (publicly editable, unminted).
  app.post('/api/admin/island-proposals/:id/accept', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false })
      return
    }
    try {
      const r = await db.query('sql/get-island-proposal', `select name, geometry_json, content, parcels from island_proposals where id = $1`, [id])
      const p = r.rows[0]
      if (!p) {
        res.status(404).json({ success: false })
        return
      }
      await upsertIsland(db, p.name, p.geometry_json, p.content)
      for (const parcel of p.parcels || []) {
        await createParcelRow(db, { id: parcel.id, address: parcel.address, owner: TEAM, island: p.name, x1: parcel.x1, y1: parcel.y1, z1: parcel.z1, x2: parcel.x2, y2: parcel.y2, z2: parcel.z2 }, true)
      }
      await db.query('sql/accept-island-proposal', `update island_proposals set status = 'accepted' where id = $1`, [id])
    } catch (e: any) {
      console.log(e)
      res.status(500).json({ success: false, message: e.toString() })
      return
    }
    res.status(200).json({ success: true })
  })

  app.post('/api/admin/island-proposals/:id/reject', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false })
      return
    }
    await db.query('sql/reject-island-proposal', `update island_proposals set status = 'rejected' where id = $1`, [id])
    res.status(200).json({ success: true })
  })
}

const TEAM = '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'

// Insert one parcel row from geo (EPSG:3857) bounds. sandbox=true makes it publicly editable + unminted.
async function createParcelRow(db: Db, p: { id: number; address: string; owner: string; island: string; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }, sandbox: boolean) {
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
  const settings = sandbox ? JSON.stringify({ sandbox: true }) : '{}'
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
      INSERT INTO islands (name, geometry_json, content, position_json)
      SELECT $1, $2::jsonb, $3, $4::jsonb WHERE NOT EXISTS (SELECT 1 FROM upsert);
    `,
    [name, geomStr, content, position_json],
  )
}
