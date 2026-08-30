import cache from '../cache'
import { createRequestHandlerForQuery } from '../lib/query-helpers'
import { Db } from '../pg'
import { Express } from 'express'
import { PassportStatic } from 'passport'
import { isValidUUID } from '../lib/helpers'
import { parseQueryInt } from '../lib/query-parsing-helpers'

const parse = {
  ethaddress: (token: any): string | undefined => {
    if (typeof token != 'string') {
      return
    }

    const s = token.toString()

    return s.match(/^0x[a-fA-F0-9]{40}$/) ? s : undefined
  },
}

export default function SpacesController(db: Db, _passport: PassportStatic, app: Express) {
  // check id exists and redirect

  app.get('/spaces/:id/play', async (req, res) => {
    const { id } = req.params
    if (!isValidUUID(id)) {
      res.status(404).send('not found')
      return
    }

    // check if space exists
    let result
    try {
      result = await db.query('spaces/check-id-exists', 'select id from spaces where id=$1', [id])
    } catch (err) {
      res.status(500).send('internal error')
      return
    }

    if (!result || !result.rows || result.rows.length === 0) {
      res.status(404).send('not found')
      return
    }

    // redirect to player for this space
    res.redirect(`/spaces/${id}`)
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

  app.get(
    '/api/wallet/:address/spaces.json',
    cache('2 seconds'),
    createRequestHandlerForQuery(db, 'get-spaces-by-owner', 'spaces', (req) => {
      const page = parseQueryInt(req.query.page, 1) - 1
      const address = parse.ethaddress(req.params.address)

      return [page, address]
    }),
  )
}
