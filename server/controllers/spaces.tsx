import { h } from 'preact'
import cache from '../cache'
import { createRequestHandlerForQuery } from '../lib/query-helpers'
import JsonData from '../../web/src/components/json-data'
import renderComponent from '../handlers/render-component'
import Space from '../space'
import { ParcelContentRecord } from '../../common/messages/parcel'
import { isLeft } from 'fp-ts/lib/Either'
import { PathReporter } from 'io-ts/lib/PathReporter'
import updateSpace from '../handlers/update-space'
import { Db } from '../pg'
import { Express, Response } from 'express'

import { PassportStatic } from 'passport'
import { isValidUUID } from '../lib/helpers'
import { VoxelsUserRequest } from '../user'
import { parseQueryInt } from '../lib/query-parsing-helpers'

const clamp = (a: number, min: number, max: number) => Math.min(Math.max(a, min), max)

const parse = {
  ethaddress: (token: any): string | undefined => {
    if (typeof token != 'string') {
      return
    }

    const s = token.toString()

    return s.match(/^0x[a-fA-F0-9]{40}$/) ? s : undefined
  },
}

export default function SpacesController(db: Db, passport: PassportStatic, app: Express) {
  app.post('/spaces/create', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const name = req.body.name.toString().slice(0, 48)
    let content = null

    const wallet = req.user ? (req.user as Express.User & { wallet: string }).wallet : null
    if (!wallet) {
      res.status(401).send({ error: 'Not Authorized' })
      return
    }

    if ('content' in req.body) {
      const r = ParcelContentRecord.decode(req.body.content)

      if (isLeft(r)) {
        const errors = PathReporter.report(r)
        console.warn(`validation error in ParcelContentRecord ${errors.length} errors`, req.body.content)

        for (const e of errors) {
          console.warn(` * ${e}`)
        }

        res.json({ success: false, message: 'Content is invalid' })
        return
      }

      content = req.body.content
    }
    // We only clamp size if it's a new Space.
    // We know it's a new space because it does not have any content
    // We have to allow the actual width given for the parcel to space feature
    const width = !!content ? req.body.width : clamp(4, 32, parseInt(req.body.width))
    const height = !!content ? req.body.height : clamp(4, 32, parseInt(req.body.height))
    const depth = !!content ? req.body.depth : clamp(4, 32, parseInt(req.body.depth))

    const env = ['day', 'night', 'void'].includes(req.body.environment) ? req.body.environment : 'day'

    if (!content) {
      content = { environment: env }
    }

    const result = await db.query(
      'embedded/insert-space',
      `
      insert into spaces
        (name, width, height, depth, owner,content, created_at, updated_at)
      values
        ($1, $2, $3, $4, $5, $6, now(), now())
      returning id`,
      [name, width, height, depth, wallet, JSON.stringify(content)],
    )

    const id = result.rows && result.rows[0].id

    if (!!id) {
      await db.query(
        'embedded/update-space-slug',
        `
        update spaces
          set slug = $1
          where
          id = $1`,
        [id],
      )
    }

    res.json({ success: result.rowCount == 1, id })
  })

  app.post('/spaces/remove', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const wallet = req.user ? (req.user as Express.User & { wallet: string }).wallet : null
    if (!wallet) {
      res.status(401).send({ error: 'Not Authorized' })
      return
    }

    const space_id = req.body.id

    if (!isValidUUID(space_id)) {
      return res.json({ success: false })
    }

    const result = await db.query(
      'embedded/delete-space',
      `
      delete from spaces
      WHERE
      id=$1 and lower(owner) = lower($2)
      returning id`,
      [space_id, wallet],
    )

    const id = result.rows[0]?.id
    res.json({ success: result.rowCount == 1, id })
  })

  app.put('/spaces/:id', passport.authenticate('jwt', { session: false }), updateSpace)

  app.get('/spaces/:id/play', cache(false), async (req, res) => {
    if (!isValidUUID(req.params.id)) {
      return res.status(404).send({ error: 'Not found' })
    }

    const id = req.params.id

    const space = await Space.load(id)
    if (!space) {
      res.redirect('/')
      return
    }

    space.addLastModifiedHeader(res)

    const title = `${space.name || 'My Space'} | Voxels Space`
    // .voxels is a getter, pulling from content, which does not work with ... spread syntax
    const summary = { ...space, voxels: space.voxels }
    // fastboot JSON in <head> (see play.tsx for why)
    const head = (
      <head>
        <title>{title}</title>
        <JsonData id="space" data={summary} dataId={space.spaceId} />
      </head>
    )

    // todo - prevent multiple reloads updating visits unless different wallet or
    //   ip or some shit (use redis yo)

    db.query(
      'embedded/update-spaces-visit',
      `
      update 
        spaces
      set
        visits = visits + 1
      where
        id = $1
    `,
      [id],
    )

    res.send(renderComponent(head))
  })

  app.get(
    '/api/spaces/:id.json',
    cache(false),
    createRequestHandlerForQuery(db, 'spaces/get-space-content', 'space', (req) => {
      if (!isValidUUID(req.params.id)) {
        throw new Error('ID parameter is not a valid UUID')
      }
      return [req.params.id]
    }),
  )

  app.get('/api/spaces/boot/:id.json', cache(false), async (req: VoxelsUserRequest, res: Response) => {
    if (!isValidUUID(req.params.id)) {
      return res.status(404).send({ error: 'Not found' })
    }
    const space = await Space.load(req.params.id)
    if (!space) {
      return res.status(404).json({ success: false, space: null, message: 'Not found' })
    }
    const summary = { ...space, voxels: space.voxels }
    res.json({ success: true, space: summary })
  })

  app.get(
    '/api/wallet/:address/spaces.json',
    cache('2 seconds'),
    createRequestHandlerForQuery(db, 'get-spaces-by-owner', 'spaces', (req) => {
      const page = parseQueryInt(req.query.page, 1) - 1
      const address = parse.ethaddress(req.params.address)

      return [page, address]
    }),
  )

  app.get(
    '/api/spaces.json',
    cache('60 seconds'),
    createRequestHandlerForQuery(db, 'spaces/browse', 'spaces', (req) => {
      const page = parseQueryInt(req.query.page, 1) - 1

      return [page]
    }),
  )
}
