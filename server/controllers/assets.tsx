import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Express, Response } from 'express'
import { RateLimitInfo } from 'express-rate-limit'
import { toJsonSchema } from 'io-ts-to-json-schema'
import multer from 'multer'
import { PassportStatic } from 'passport'
import path from 'path'
import { v7 as uuid } from 'uuid'
import { FeatureRecord } from '../../common/messages/feature'
import Scope from '../../common/scope'
import type { FeatureTemplate } from '../../src/features/_metadata'
import ClientRoot from '../../web/src/client-root'
import JsonData from '../../web/src/components/json-data'
import cache from '../cache'
import { addAssetToLibrary, removeAssetFromLibrary, updateAssetFromLibrary } from '../handlers/asset-library-handler'
import renderRoot from '../handlers/render-root'
import { isAdmin, isValidUUID } from '../lib/helpers'
import log from '../lib/logger'
import { createRequestHandlerForQuery, queryAndCallback } from '../lib/query-helpers'
import { parseQueryInt } from '../lib/query-parsing-helpers'
import LibraryAsset from '../library-asset'
import Collection from '../collection'
import { Db, pgp } from '../pg'
import { VoxelsUserRequest } from '../user'
import Wearable, { WearableCategory } from '../wearable'

// Configure multer for memory storage (or disk storage if you prefer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
})

export default function AssetLibraryController(db: Db, passport: PassportStatic, app: Express) {
  // const ASSETS_BUCKET = process.env.UGC_ASSETS_BUCKET || 'voxels-ugc'
  // const AWS_REGION = process.env.UGC_AWS_REGION || 'syd1'
  // const AWS_ENDPOINT = process.env.UGC_AWS_ENDPOINT || 'https://syd1.digitaloceanspaces.com'
  const ASSETS_BUCKET = 'voxels-ugc'
  const AWS_REGION = 'syd1'
  const AWS_ENDPOINT = 'https://syd1.digitaloceanspaces.com'
  const AWS_ACCESS_KEY_ID = 'DO801UZARQ8UZC3XFWTT'
  const AWS_SECRET_ACCESS_KEY = process.env.UGC_SECRET || ''

  app.post('/api/assets/upload', passport.authenticate('jwt', { session: false }), upload.single('file'), async (req: VoxelsUserRequest, res, next) => {
    if (!AWS_SECRET_ACCESS_KEY) {
      console.error('AWS_SECRET_ACCESS_KEY is not set')

      return res.status(500).json({
        success: false,
        error: 'Access key not set',
      })
    }

    const wallet = req.user!.wallet
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      })
    }

    console.log({ region: AWS_REGION, endpoint: AWS_ENDPOINT, credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY.slice(0, 2) + '...' } })

    const s3 = new S3Client({
      region: AWS_REGION,
      endpoint: AWS_ENDPOINT,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
      forcePathStyle: false,
    })

    const assetId = uuid()
    const Key = `${wallet}/${assetId}/${req.file.originalname}`

    const command = new PutObjectCommand({
      Bucket: ASSETS_BUCKET,
      Key, // Use originalname instead of name
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read',
    })

    console.log({
      Bucket: ASSETS_BUCKET,
      Key, // Use originalname instead of name
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read',
    })

    // Upload to S3

    try {
      var upload = await s3.send(command)
    } catch (e) {
      next(e)
      return
    }

    if (!upload.ETag) {
      return res.status(500).json({
        success: false,
        error: 'Failed to upload asset',
      })
    }

    const s3Url = `https://ugc.crvox.com/${Key}`

    // Confirm the file exists
    const fileExists = await fetch(s3Url)

    if (!fileExists.ok) {
      console.error('Failed to upload asset', s3Url)

      res.status(500).json({
        success: false,
        error: 'Failed to upload asset',
      })

      return
    }

    // Construct the asset content
    var feature = {}

    const ext = path.extname(req.file.originalname)

    switch (ext) {
      case '.png':
        feature = {
          type: 'image',
          url: s3Url,
        }
        break
      case '.vox':
        feature = {
          type: 'vox-model',
          url: s3Url,
        }
        break
    }

    const content = [feature]

    try {
      await db.query(
        'sql/insert-asset',
        `
          insert into asset_library 
            (id, name, author, content, created_at, updated_at)
          values 
            ($1, $2, $3, $4, now(), now())
          returning 
            id
        `,
        [assetId, req.file.originalname, wallet, JSON.stringify(content)],
      )
    } catch (e) {
      next(e)
      return
    }

    const collectionId = parseInt(req.body.collection_id, 10)
    let wearable: any

    if (ext === '.vox' && collectionId) {
      const baseName = path.basename(req.file.originalname, ext)
      const w = new Wearable({
        name: baseName || req.file.originalname,
        description: '',
        author: wallet,
        issues: 100000,
        data: new Uint8Array(req.file.buffer),
        collection_id: collectionId,
        category: WearableCategory.Accessory,
      })

      try {
        var wr = await w.create()
      } catch (e) {
        next(e)
        return
      }

      if (wr.success) {
        await w.generateTokenId()
      }

      wearable = {
        id: w.id,
        name: w.name,
        description: w.description,
        collection_id: w.collection_id,
      }
    }

    res.json({
      success: true,
      asset: {
        id: assetId,
        name: req.file.originalname,
        author: wallet,
        content: content,
      },
      wearable,
    })
  })

  const conditions = (scope: Scope) => {
    const conditions = []

    // Only display vox model assets for now
    conditions.push(`a.content::jsonb @> '[{"type": "vox-model"}]'`)

    if (scope.query) {
      // we should get a vector column in here my bro
      conditions.push(`(a.name ILIKE '%' || $<scope.query> || '%' OR a.description ILIKE '%' || $<scope.query> || '%')`)
    }

    if (scope.author) {
      conditions.push(`a.author = $<scope.author>`)
    }

    return conditions.length > 0 ? conditions.join(' AND ') : 'true'
  }

  const sorting = (scope: Scope) => {
    var term = 'a.id'

    if (scope.sort == 'name') {
      term = 'a.name'
    }
    if (scope.sort == 'created_at') {
      term = 'a.created_at'
    }
    if (scope.sort == 'views') {
      term = 'a.views'
    }

    return `${term} ${scope.reverse ? 'DESC' : 'ASC'}`
  }

  app.get('/api/assets', async (req, res) => {
    const scope = Scope.parse('/api/assets', req.query)

    const sql = `
      select 
        *
      from
        asset_library a
      where
        ${conditions(scope)}
      order by
        ${sorting(scope)}
      limit
        $<scope.limit>
      offset
        $<scope.offset>
    `

    const assets = await pgp.manyOrNone(sql, { scope })
    res.json({ success: true, assets })
  })

  app.delete('/api/assets/:uuid', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res, next) => {
    const id = req.params.uuid

    try {
      await db.query('sql/delete-asset', `delete from asset_library where id = $1 and author ILIKE $2`, [id, req.user!.wallet!])
    } catch (e) {
      next(e)
      return
    }

    res.json({ success: true })
  })

  app.get('/api/assets/categories', cache('1 minute'), async (req, res) => {
    let result = await db.query('sql/asset-library/get-categories', `select distinct category from asset_library`)

    res.json({ success: true, categories: result.rows.map((r: any) => r.category) })
  })

  app.get('/api/assets/schema', cache('1 minute'), async (req, res) => {
    const schema = toJsonSchema(FeatureRecord)
    res.json({ success: true, schema })
  })

  app.put('/api/assets/:uuid', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res, next) => {
    const id = req.params.uuid
    const wallet = req.user!.wallet

    const asset = await pgp.oneOrNone('select * from asset_library where id = $<id>', { id })

    if (!asset) {
      return res.status(404).send({ error: 'Not found' })
    }

    if (isAdmin(req) || asset.author === wallet) {
      // ok
    } else {
      return res.status(403).send({ error: 'Forbidden' })
    }

    const params = Object.assign({}, asset, req.body)
    const content = JSON.stringify(params.content)

    try {
      await pgp.none(
        `
        update
          asset_library
        set
          name = $<params.name>,
          description = $<params.description>,
          category = $<params.category>,
          content = $<content>::json,
          updated_at = now()
        where
          id = $<id>
      `,
        { params, content, id },
      )

      console.log(req.body)
      console.log('Updated asset', params, content, id)
    } catch (e) {
      next(e)
      return
    }

    res.json({ success: true })
  })

  // Grabs asset from library and doesn't add view count
  app.get('/api/assets/:uuid', async (req, res, next) => {
    const id = req.params.uuid

    if (!isValidUUID(id)) {
      return res.status(404).send({ error: 'Not found' })
    }

    try {
      var result = await db.query(
        'sql/asset/wearable',
        `
        select
          id,
          name,
          description,
          author,
          issues,
          token_id,
          created_at,
          updated_at,
          hash,
          rejected_at,
          offer_prices,
          collection_id,
          custom_attributes,
          suppressed,
          category,
          default_settings
        from
          wearables
        where
          id = $1
      `,
        [id],
      )
    } catch (e) {
      next(e)
      return
    }

    if (result.rows[0]) {
      const asset = result.rows[0]
      asset.type = 'wearable'

      res.json({ success: true, asset })
      return
    }

    try {
      result = await db.query(
        'sql/asset/wearable',
        `
        select
          *
        from
          asset_library
        where
          id = $1
      `,
        [id],
      )
    } catch (e) {
      next(e)
      return
    }

    if (result.rows[0]) {
      const asset = result.rows[0]
      asset.type = 'asset'

      res.json({ success: true, asset })
      return
    }

    return res.status(404).send({ error: 'Not found' })
  })

  app.get('/assets/:id/play', cache(false), async (req, res) => {
    const isBase64 = typeof req.query.encoded === 'string'
    /**
     * We allow either a base64 encoded asset content or a UUID referencing an asset in the library
     */
    const isUUID = isValidUUID(req.params.id)
    if (!isBase64 && !isUUID) {
      return res.status(404).send({ success: false, error: 'Not found' })
    }

    let features: FeatureTemplate[] = []
    const id = req.params.id

    if (isBase64 && !isUUID) {
      try {
        features = JSON.parse(Buffer.from(req.params.id, 'base64').toString('utf-8'))
      } catch (e) {
        return res.status(400).send({ success: false, error: 'Invalid encoded content' })
      }
    } else if (isUUID) {
      const result = await db.query('embedded/get-space', `select id, hash, content from asset_library a where id= $1`, [id])
      const asset = result.rows[0]

      if (!asset) {
        res.json({ success: false })
        return
      }

      // filter out scripts
      features = asset.content.filter((f: FeatureTemplate | string) => typeof f !== 'string')
    }

    if (features.length === 0) {
      return res.status(404).send({ success: false, error: 'No features found in asset' })
    }

    const translate = (array: FeatureTemplate[], y: number, parent?: string) => {
      const progeny: Array<FeatureTemplate> = []

      array.forEach((f: FeatureTemplate & { id?: string; groupId?: string }) => {
        const id = uuid()
        f.id = id

        if (parent) {
          f.groupId = parent
        }

        if (f.position) {
          f.position[1] += y
        } else {
          f.position = [0, y, 0]
        }

        if (f.type === 'group' && f.children) {
          const children = f.children.slice()
          delete f.children

          progeny.push(...translate(children, y, id))
        }
      })

      return array.concat(progeny)
    }

    for (const f of features) {
      if (f.scale) {
        // ...
      } else {
        f.scale = [4, 4, 4]
      }
    }

    if (features.length == 1 && features[0].type != 'group') {
      features[0].position = [0, 0.75, 0]
    } else {
      features = translate(features, 1.75)
    }

    const summary = {
      kind: 'asset',
      is_common: false,
      _justGotMinted: false,
      id,
      name: 'asset-preview',
      parcel_id: null,
      owner: '0xa253d7cd38dc2d0b2e65ad42a7e4beb3c60a83ad',
      content: { features },
      width: 4,
      height: 4,
      depth: 4,
      created_at: '2023-05-23T15:28:34.997Z',
      updated_at: '2023-05-23T15:29:24.177Z',
      description: null,
      slug: 'c2c64c76-e0db-40d1-8f85-3e3580875388',
      settings: {},
      unlisted: false,
      visits: 4,
      lightmap_url: null,
      memoized_hash: '2ef8460666c5dd4cb0aac794c06854b55650669f',
      state: null,
      x1: 0,
      y1: 0,
      z1: 0,
      x2: 4,
      y2: 4,
      z2: 4,
      island: '',
      suburb: 'The void',
      address: 'Nowhere near',
      hash: '2ef8460666c5dd4cb0aac794c06854b55650669f',
      spaceId: id,
    }

    const html = (
      <ClientRoot title="Asset">
        <JsonData id="space" data={summary} dataId={id} />
      </ClientRoot>
    )

    res.send(renderRoot(html))
  })

  // AssetLibrary
  app.post('/api/library/add', passport.authenticate('jwt', { session: false }), addAssetToLibrary)
  app.post('/api/library/remove', passport.authenticate('jwt', { session: false }), removeAssetFromLibrary)
  app.post('/api/library/update', passport.authenticate('jwt', { session: false }), updateAssetFromLibrary)

  // Grabs asset content only and add to the view count
  app.post('/api/library/asset/:uuid', passport.authenticate('jwt', { session: false }), cache('10 seconds'), async (req: VoxelsUserRequest, res: Response) => {
    queryAndCallback(db, 'asset-library/get-asset-content', 'asset', [typeof req.params.uuid == 'string' ? req.params.uuid : '', req.user?.wallet], async (response) => {
      if (response.success) {
        let limited = false
        if ('rateLimit' in req) {
          const rateLimit = req.rateLimit as RateLimitInfo
          limited = rateLimit.current > 1
        } else {
          log.error('No rate limit info in request, check middle ware is working')
        }
        // update views count only 1 time per IP per day
        if (!limited) LibraryAsset.updateViewsCount(response.asset.id)
      }
      res.status(response.success ? 200 : 404).send(response)
    })
  })

  app.get(
    '/api/library/all.json',
    cache('10 seconds'),
    createRequestHandlerForQuery(db, 'asset-library/get-all-paged', 'assets', (req) => {
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN
      const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN

      return [
        `%${req.query.q || ''}%`,
        isNaN(limit) ? 50 : limit,
        isNaN(page) ? null : page,
        req.query.sort ? req.query.sort : 'id',
        req.query.asc === 'true',
        !!req.query.category ? req.query.category : null,
        !!req.query.featureType ? req.query.featureType : null,
      ]
    }),
  )
  app.get('/api/library/all/:wallet.json', passport.authenticate('jwt', { session: false }), cache('10 seconds'), async (req: VoxelsUserRequest, res: Response) => {
    if (typeof req.params.wallet !== 'string') {
      res.status(404).send({ success: false })
      return
    }
    if (req.params.wallet.toLowerCase() !== req.user?.wallet?.toLowerCase()) {
      res.status(400).send({ success: false })
      return
    }
    const limit = parseQueryInt(req.query.limit, 50)

    const page = parseQueryInt(req.query.page)

    queryAndCallback(
      db,
      'asset-library/get-all-by-author',
      'assets',
      [
        `%${req.query.q || ''}%`,
        limit,
        isNaN(page) ? null : page,
        req.user.wallet,
        req.query.privateOnly == 'true',
        req.query.sort ? req.query.sort : 'id',
        req.query.asc === 'true',
        !!req.query.category ? req.query.category : null,
        !!req.query.featureType ? req.query.featureType : null,
      ],
      (response) => {
        res.status(200).send(response)
      },
    )
  })
  app.get(
    '/api/library/features.json',
    cache('10 seconds'),
    createRequestHandlerForQuery(db, 'asset-library/get-features-paged', 'assets', (req) => {
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN
      const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN

      return [
        `%${req.query.q || ''}%`,
        isNaN(limit) ? 50 : limit,
        isNaN(page) ? null : page,
        req.query.sort ? req.query.sort : 'id',
        req.query.asc === 'true',
        !!req.query.category ? req.query.category : null,
        !!req.query.featureType ? req.query.featureType : null,
      ]
    }),
  )
  app.get(
    '/api/library/scripts.json',
    cache('10 second'),
    createRequestHandlerForQuery(db, 'asset-library/get-scripts-paged', 'assets', (req) => {
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN
      const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN

      return [`%${req.query.q || ''}%`, isNaN(limit) ? 50 : req.query.limit, isNaN(page) ? null : req.query.page, req.query.sort ? req.query.sort : 'id', req.query.asc === 'true']
    }),
  )

  app.get(
    '/api/library/info.json',
    cache('30 seconds'),
    passport.authenticate(['jwt', 'anonymous'], { session: false }),
    createRequestHandlerForQuery(db, 'asset-library/get-library-info', 'info', (req) => [
      `%${req.query.q || ''}%`,
      !!req.query.category ? req.query.category : null,
      !!req.query.featureType ? req.query.featureType : null,
      (req.user as Express.User & { wallet?: string })?.wallet,
      req.query.privateOnly == 'true',
    ]),
  )
}
