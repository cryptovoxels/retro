import { createRequestHandlerForQuery, queryAndCallback } from '../lib/query-helpers'

import cache, { noCache } from '../cache'
import config from '../../common/config'
import proxy from 'express-http-proxy'
import Parcel, { ParcelRef } from '../parcel'
import { revertParcel, sandboxRollback } from '../handlers/update-parcel'
import voxExport from '../handlers/vox-export'
import { numberOfQuarterOfDaySinceGenesis } from '../lib/utils'
import authParcel from '../auth-parcel'
import { Db, pgp } from '../pg'
import { PassportStatic } from 'passport'
import { Express } from 'express'
import { VoxelsUser } from '../user'
import { isAddress } from 'ethers'

const HEADINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

export default function (db: Db, passport: PassportStatic, app: Express) {
  app.get('/api/sandboxes.json', cache('60 seconds'), createRequestHandlerForQuery(db, 'get-sandbox-parcels', 'sandboxes'))

  // Parcels
  // This API route supports a `parcels_ids` flag which can be repeated multiple times.
  app.get('/api/parcels.json', cache('5 minutes'), async (req, res) => {
    const parcel_ids = req.query.parcel_ids ? (req.query.parcel_ids instanceof Array ? req.query.parcel_ids : [req.query.parcel_ids]) : null
    if (!parcel_ids) {
      queryAndCallback(db, 'get-parcels', 'parcels', [req.query.limit], (response) => {
        res.status(200).send(response)
      })
      return
    }
    // Number('') and Number('Infinity') are not NaN, so an empty or non-finite id
    // used to reach the query as a literal and make it invalid.
    const ids = parcel_ids.map((id: any) => Number(id)).filter((id: number) => Number.isInteger(id))
    const batch_queries = `select p.id,
      y2 - y1 as height,
      p.island,
      p.address,
      p.name,
      p.geometry_json as geometry,
      p.x1,
      p.x2,
      y1,
      y2 - y1 as y2,
      p.z1,
      p.z2,
      label,
      description,
      owner
      from
      properties p
      where
      p.id = any($1::int[])
    `

    const r = await db.query('embedded/get-parcels-batched', batch_queries, [ids])
    res.status(200).send({ success: !!r.rows[0], parcels: r.rows })
  })

  app.get('/api/parcels/summary.json', cache('1 hour'), async (req, res) => {
    queryAndCallback(db, 'parcels/summary', 'parcels', [], (response) => {
      res.status(200).send(response)
    })
  })

  // Route to Obtain the content of every parcels the user owns.
  app.get('/api/parcels/search.json', cache('5 minutes'), async (req, res) => {
    let limit: number | undefined = undefined

    if (typeof req.query.limit === 'string') {
      limit = parseInt(req.query.limit, 10)

      if (isFinite(limit)) {
        limit = Math.min(50, limit)
      } else {
        limit = 50
      }
    }

    let page: number | undefined

    if (typeof req.query.page === 'string') {
      page = parseInt(req.query.page, 10)

      if (!isFinite(page)) {
        page = undefined
      }
    }

    let query: string

    if (typeof req.query.q !== 'string') {
      res.status(400).send({ success: false })

      return
    } else if (isAddress(req.query.q!)) {
      query = req.query.q?.toString()
    } else if ((req.query.q as any).match(/^[0-9]+$/)) {
      // is a parcel id
      const id = parseInt(req.query.q!, 10)
      const params = [id, limit, page, req.query.sort ? req.query.sort : 'id', req.query.asc === 'true']

      queryAndCallback(db, 'parcels/search-parcels-by-id', 'parcels', params, (response) => {
        res.status(200).send(response)
      })

      return
    } else {
      query = '%' + (req.query.q as any)?.toString().slice(0, 1024) + '%'
    }

    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'id'
    const direction = req.query.asc === 'true' ? 'ASC' : 'DESC'

    let orderBy = ''

    switch (sort.toLowerCase()) {
      case 'id':
        orderBy = `properties.id ${direction}`
        break
      case 'name':
        orderBy = `properties.name ${direction}`
        break
      case 'height':
        orderBy = `properties.y2-properties.y1 ${direction}`
        break
      case 'island':
        orderBy = `properties.island ${direction}`
        break
      case 'distance':
        orderBy = `properties.distance_to_center ${direction}`
        break
      default:
        orderBy = `properties.id DESC`
    }

    const sql = `
      select
        properties.id as id,
        y2 - y1 as height,
        address,
        properties.kind,
        suburbs.name as suburb,
        properties.island,
        properties.name as name,
        geometry_json as geometry,
        CAST(distance_to_center as double precision),
        CAST(distance_to_ocean as double precision),
        CAST(distance_to_closest_common as double precision),
        COALESCE(
          (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(properties.owner) LIMIT 1) sub),
          to_json(lower(properties.owner))
        ) as owner,
        properties.x1,
        properties.x2,
        y1,
        label,
        y2 - y1 as y2,
        properties.z1,
        properties.z2,
        memoized_hash as hash,
        count(*) OVER() AS pagination_count
      from
        properties
      left join suburbs on suburbs.id = properties.suburb_id
        where (is_common <> true)
      and
        (minted = true)
      and
        (address ILIKE $1  or  properties.island ILIKE $1 or properties.name ILIKE $1 or lower(properties.owner)=lower($1) or EXISTS (SELECT 1 FROM avatars av WHERE lower(av.owner)=lower(properties.owner) AND av.name ILIKE $1))
      order by
        ${orderBy}
      limit
        $2
      offset
        coalesce(($2::integer * $3::integer),0);
  `

    const params = [query, limit, page]
    const result = await db.query('parcels/search', sql, params)

    res.status(200).send({ success: true, parcels: result.rows })
  })

  app.get('/api/parcels/favorites.json', cache('5 minutes'), (req, res) => {
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN
    const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN

    const queryParameters = [`%${req.query.q || ''}%`, isNaN(limit) ? null : req.query.limit, isNaN(page) ? null : req.query.page, req.query.sort ? req.query.sort : 'id', req.query.asc === 'true']

    queryAndCallback(db, 'parcels/favorite-parcels', 'parcels', queryParameters, (response) => {
      res.status(200).send(response)
    })
  })

  app.get('/api/parcels/xyz.json', cache('5 minutes'), async (req, res) => {
    const geometry_query = `select p.id,
      y2 - y1 as height,
      p.geometry_json as geometry,
      p.x1,
      p.x2,
      y1,
      y2 - y1 as y2,
      p.z1,
      p.z2
      from
      properties p
      `

    const r = await db.query('embedded/get-parcel-geometry-batched', geometry_query)
    res.status(200).send({ success: !!r.rows[0], parcels: r.rows })
  })

  app.get(
    '/api/suburbs/:suburb_id/popular.json',
    cache('30 minutes'),
    createRequestHandlerForQuery(db, 'parcels/get-popular-by-suburb', 'parcels', (req) => {
      const days = typeof req.query.days === 'string' ? parseInt(req.query.days, 10) : NaN
      const suburb_id = parseInt(req.params.suburb_id, 10)

      return [numberOfQuarterOfDaySinceGenesis(), isNaN(days) ? 7 : days, isNaN(suburb_id) ? null : suburb_id]
    }),
  )

  // Route to create a snapshot: set is_snapshot = true
  app.post('/api/parcels/snapshot', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const { parcel_id, id, is_snapshot } = req.body
    if (is_snapshot) {
      // version is already a snapshot;
      res.json({ success: false, message: 'Version is already a snapshot' })
      return
    }
    const parcel = await Parcel.load(parcel_id)

    if (!parcel) {
      res.json({ success: false, message: 'Parcel does not exists' })
      return
    }

    const user = req.user as VoxelsUser | null
    if (!user || !user.wallet) {
      return res.status(401).send({ success: false, message: 'You are not authorized to do this' })
    }

    const auth = await authParcel(parcel, user)

    if (auth !== 'Owner') {
      res.json({ success: false, message: 'You do not have the right to create a snapshot' })
      return
    }
    let result: { success: boolean; id?: number }
    if (id) {
      // We have been given a version id; this means we want that version id to be a snapshot, not the current parcel content.
      const r = await db.query('embedded/update-property-version-snapshot', `update property_versions set is_snapshot = true,updated_at=now() where id = $1 returning id`, [id])
      result = { success: !r.rows[0]?.id, id: r?.rows[0]?.id }
    } else {
      result = await parcel.takeSnapshot()
    }
    if (!result.success) {
      res.status(200).send({ success: false })
      return
    }
    res.status(200).send({ success: true, id: result.id })
  })

  // Route to remove a snapshot: Set is_snapshot = false
  app.post('/api/parcels/snapshot/remove', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const { version } = req.body
    if (!version || !version.id || !version.parcel_id) {
      res.status(200).send({ success: false })
      return
    }

    const parcel = await Parcel.load(version.parcel_id)
    if (!parcel) {
      res.json({ success: false, message: 'Parcel does not exists' })
      return
    }
    const user = req.user as VoxelsUser | null
    if (!user || !user.wallet) {
      return res.status(401).send({ success: false, message: 'You are not authorized to do this' })
    }

    const auth = await authParcel(parcel, user)

    if (auth !== 'Owner') {
      res.json({ success: false, message: 'You do not have the right to create a snapshot' })
      return
    }

    const r = await db.query('embedded/remove-property-version-snapshot', `update property_versions set is_snapshot = false,updated_at=now() where id = $1 returning id`, [version.id])

    res.status(200).send({ success: !!r.rows[0], id: r.rows[0].id || null })
  })

  // Route to edit snapshot attributes (just name atm)
  app.put('/api/parcels/snapshot', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const { version, name, ipfs_hash } = req.body

    if (!version) {
      res.status(200).send({ success: false })
      return
    }
    let r
    if (name) {
      // Set name of snapshot
      r = await db.query('embedded/update-property-version-snapshot_name', `update property_versions set snapshot_name = $1,updated_at=now() where id = $2 returning id`, [name, version.id])
    }

    if (ipfs_hash) {
      // Set ipfs_hash of snapshot
      r = await db.query('embedded/update-property-version-snapshot_ipfs_hash', `update property_versions set ipfs_hash = $1,updated_at=now() where id = $2 returning id`, [ipfs_hash, version.id])
    }

    if (!r) {
      res.status(200).send({ success: false })
      return
    }

    if (r.rows.length) {
      res.status(200).send({ success: true, id: r.rows[0].id })
      return
    }

    res.status(200).send({ success: false })
  })

  // Route to Obtain the snapshots of a parcel, no cache because refreshing would not show the newest name even with 1s cache.
  app.get(
    '/api/parcels/:id/snapshots.json',
    cache(false),
    createRequestHandlerForQuery(db, 'get-parcel-snapshots', 'snapshots', (req) => [req.params.id, req.query.autosave === 'include']),
  )

  if (config.isDevelopment) {
    app.use('/api/parcels/map.json', cache(false), proxy('https://www.voxels.com', { proxyReqPathResolver: (req) => req.originalUrl }))
  } else {
    app.get('/api/parcels/map.json', cache('1 day'), createRequestHandlerForQuery(db, 'get-parcels-map', 'parcels'))
  }

  // Route to Obtain the content of every parcels the user owns.
  app.get(
    '/api/parcels/resources/:wallet.json',
    passport.authenticate(['jwt', 'anonymous'], { session: false }),
    cache('1 second'),
    createRequestHandlerForQuery(db, 'get-parcels-content-by-owner', 'resources', (req) => [req.params.wallet]),
  )

  // Route to get all contributors and their name
  app.get(
    '/api/parcels/:id/users.json',
    passport.authenticate(['jwt', 'anonymous'], { session: false }),
    cache('5 second'),
    createRequestHandlerForQuery(db, 'parcels/get-users-rights-by-parcel', 'users', (req) => [req.params.id]),
  )
  app.post('/api/parcels/:id/revert', passport.authenticate(['jwt', 'anonymous'], { session: false }), revertParcel)
  app.post('/api/parcels/:id/sandbox-rollback', passport.authenticate(['jwt', 'anonymous'], { session: false }), sandboxRollback)

  app.get('/api/parcels/:id.vox', cache('15 seconds'), async (req, res) => {
    const parcel_id = parseInt(req.params.id, 10)
    if (isNaN(parcel_id)) {
      res.status(404).json({ success: false })
      return
    }

    const parcel = await Parcel.load(parcel_id)
    if (!parcel) {
      res.status(404).json({ success: false })
      return
    }
    voxExport(parcel, req, res)
    // res.json({success : true, parcel: parcel.summary})
  })

  // Route to allow users to share their parcels without using ?coords=
  app.get('/parcels/:id/visit', cache('15 seconds'), async (req, res) => {
    const id = Number(req.params.id)
    if (isNaN(id)) {
      res.redirect('/')
      return
    }
    const parcel = await Parcel.load(id)

    if (!parcel) {
      res.redirect('/')
      return
    }

    function getSpawn() {
      const p = parcel as Parcel
      // find the first spawn point
      let spawnFeature = null
      if (p.content && p.content.features) {
        spawnFeature = p.content?.features?.find((f: any) => f?.type === 'spawn-point')
      }

      if (!spawnFeature) {
        return `/play?coords=${p.location}`
      }
      const spawnPosition = spawnFeature.position
      const yRotation = parseFloat(spawnFeature.rotation[1])

      const i = mod(Math.round(yRotation / ((Math.PI * 2) / HEADINGS.length)), HEADINGS.length)
      const heading = HEADINGS[i]

      const z = roundHalf(p.center[1] * 100 + parseFloat(spawnPosition[2]))
      const x = roundHalf(p.center[0] * 100 + parseFloat(spawnPosition[0]))

      const result = [x < 0 ? `${Math.abs(x)}W` : `${x}E`, z < 0 ? `${Math.abs(z)}S` : `${z}N`]

      // only add U if above ground
      const y = roundHalf(p.y1 + (parseFloat(spawnPosition[1]) - 0.25)) // for some reason the spawn is centered wrong
      if (y > 0) {
        result.push(`${y}U`)
      }

      return `/play?coords=${heading}@${result.join(',')}`
    }

    const { mode, gateway } = req.query
    let url = getSpawn()
    url += mode ? `&mode=${mode}` : ''
    if (gateway === '1' || gateway === 'true') url += '&gateway=1'
    res.redirect(url)
  })

  app.get('/api/parcels/:id.jpg', async (req, res) => res.redirect(301, '/api/parcels/' + req.params.id + '.png'))
  app.get('/api/parcels/:id.png', cache('30 minutes'), async (req, res) => {
    const id = Number(req.params.id)
    if (isNaN(id)) {
      res.status(404).send({ success: false, message: 'Parcel not found' })
      return
    }
    res.redirect(302, `/renderer/v1/parcel/${id}.webp`)
  })

  app.get(
    '/api/parcels/:id/history.json',
    cache('10 seconds'),
    createRequestHandlerForQuery(db, 'get-parcel-history', 'versions', (req) => {
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN
      const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN
      const start_date = typeof req.query.start_date === 'string' ? parseInt(req.query.start_date, 10) : NaN
      const end_date = typeof req.query.end_date === 'string' ? parseInt(req.query.end_date, 10) : NaN

      return [parseInt(req.params.id, 10), isNaN(limit) ? null : limit, isNaN(page) ? null : page, req.query.asc === 'true', isNaN(start_date) ? null : start_date, isNaN(end_date) ? null : end_date]
    }),
  )

  app.get(
    '/api/parcels/:id/history-count.json',
    cache('10 seconds'),
    createRequestHandlerForQuery(db, 'get-parcel-history-count', 'info', (req) => [parseInt(req.params.id, 10)]),
  )

  app.get(
    '/api/parcels/:id/history/:version.json',
    cache('1 second'),
    createRequestHandlerForQuery(db, 'get-parcel-by-version', 'version', (req) => [parseInt(req.params.id, 10), req.params.version]),
  )

  app.get('/api/parcels/:id/list', cache(false), passport.authenticate('jwt', { session: false }), async (req, res) => {
    const parcelId = parseInt(req.params.id, 10)
    if (isNaN(parcelId)) {
      res.status(404).send({ success: false })
      return
    }

    const user = req.user as VoxelsUser | null
    if (!user || !user.wallet) {
      return res.status(401).send({ success: false })
    }

    const parcel: ParcelRef | null = await Parcel.loadRef(parcelId)
    if (!parcel) {
      res.status(200).send({ success: false })

      return
    }

    if (parcel.owner.toLowerCase() != process.env.OWNER_ADDRESS!.toLowerCase() && parcel.kind != 'inner' && parcel.island !== 'Pastel') {
      // At the moment only inner and pastel parcels can be listed.
      // if parcel owned by CRVOX though that's fine
      res.status(200).send({ success: false, error: 'Not an Architect island or Pastel island parcel' })

      return
    }

    try {
      await db.query(
        'embedded/update_listed_at_parcels',
        `update properties set listed_at = now()
       where id = $1 and
       (lower(owner)=lower($2) OR (select moderator from avatars where lower(avatars.owner) = lower($2))::bool)`,
        [parcelId, user.wallet],
      )
      res.status(200).send({ success: true })
    } catch (err: any) {
      res.status(200).send({ success: false, error: err.toString ? err.toString() : err })
    }
  })
}

function roundHalf(value: number) {
  return Math.round(value * 2) / 2
}

function mod(n: number, m: number) {
  // javascript can't do negative modulo
  return ((n % m) + m) % m
}
