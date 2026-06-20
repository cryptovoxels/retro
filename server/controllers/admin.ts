import { Express } from 'express'
import { centroid } from '@turf/turf'

import cache from '../cache'

import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { isAdmin } from '../lib/helpers'

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

  app.post('/api/admin/parcels/create', passport.authenticate('jwt', { session: false }), async (req, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ success: false, message: 'Unauthorized' })
      return
    }

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

    // Create WKT POLYGON from x/z bounds (Y is height, ignored here)
    const scale = 1
    const minX = Math.min(x1, x2) * scale
    const maxX = Math.max(x1, x2) * scale
    const minZ = Math.min(z1, z2) * scale
    const maxZ = Math.max(z1, z2) * scale

    const x1c = Math.round(Math.min(x1, x2) * 100)
    const x2c = Math.round(Math.max(x1, x2) * 100)
    const z1c = Math.round(Math.min(z1, z2) * 100)
    const z2c = Math.round(Math.max(z1, z2) * 100)
    const ring = [
      [minX, minZ],
      [minX, maxZ],
      [maxX, maxZ],
      [maxX, minZ],
      [minX, minZ],
    ]
    const geometry_json = JSON.stringify({
      type: 'Polygon',
      crs: { type: 'name', properties: { name: 'EPSG:3857' } },
      coordinates: [ring],
    })

    const kind = 'plot'

    try {
      var result = await db.query(
        'sql/create-parcel',
        `
        INSERT INTO 
          properties (id, address, owner, y1, y2, geometry_json, x1, x2, z1, z2, bounds, visible, island, kind)
        VALUES 
          ($1, $2, $3, $4::float8, $5::float8, $6::jsonb, $7::float8, $8::float8, $9::float8, $10::float8, cube(ARRAY[$7::float8,$4::float8,$9::float8], ARRAY[$8::float8,$5::float8,$10::float8]), true, $11, $12)
      `,
        [id, address, owner, y1, y2, geometry_json, x1c, x2c, z1c, z2c, island, kind],
      )
    } catch (e: any) {
      console.log(e)
      res.status(500).json({ success: false, message: e.message })
      return
    }

    res.status(200).json({ success: true })
  })

  // Upsert island
  app.post('/api/admin/islands', passport.authenticate('jwt', { session: false }), async (req, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ success: false, message: 'Unauthorized' })
      return
    }

    const { name, geometry, content } = req.body

    console.log(name, geometry, content)

    console.log(JSON.stringify(geometry, null, 2))

    const geomStr = JSON.stringify(geometry)
    let position_json = '{}'
    try {
      const c = centroid(JSON.parse(geomStr) as any)
      position_json = JSON.stringify(c.geometry)
    } catch {
      // todo: invalid geometry from admin
    }

    try {
      await db.query(
        'sql/upsert-island',
        `
      WITH upsert AS (
        UPDATE
          islands
        SET
          geometry_json = $2::jsonb,
          position_json = $4::jsonb,
          content = $3
        WHERE
          name = $1
        RETURNING *
      )

      INSERT INTO
        islands (name, geometry_json, content, position_json)
      SELECT
        $1, $2::jsonb, $3, $4::jsonb
      WHERE
        NOT EXISTS (SELECT 1 FROM upsert);
    `,
        [name, geomStr, content, position_json],
      )
    } catch (e: any) {
      console.log(e)

      res.status(500).json({ success: false, message: e.toString() })
      return
    }

    res.status(200).json({ success: true })
  })
}
