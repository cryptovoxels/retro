import { h } from 'preact'
import JsonData from '../../web/src/components/json-data'
import cache from '../cache'
import renderComponent from '../handlers/render-component'
import { Islands } from '../islands'
import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { Express } from 'express'
// import 'babylonjs' // BABYLON
const isProduction = process.env.NODE_ENV === 'production'

export default function PlayController(db: Db, passport: PassportStatic, app: Express) {
  app.get('/play', cache('60 seconds'), passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req, res) => {
    if (req.query.embedded === 'true' && req.query.isolate === 'true' && typeof req.query.coords === 'string') {
      const m = req.query.coords.match(/(\d+)([EW]).*?(\d+)([NS])/)
      if (m) {
        const x = m[2] === 'W' ? -Number(m[1]) : Number(m[1])
        const z = m[4] === 'S' ? -Number(m[3]) : Number(m[3])
        // x1..z2 are int4, so a coordinate past that range makes the statement
        // invalid, and express does not catch the rejection: the response never
        // ends and the request sits until the gateway gives up 25 seconds later.
        if (Math.abs(x) <= 2147483647 && Math.abs(z) <= 2147483647) {
          const r = await db.query('embedded/opensea-play-redirect', `select id from properties where x1 <= $1 and $1 <= x2 and z1 <= $2 and $2 <= z2 limit 1`, [x, z])
          if (r.rows[0]) return res.redirect(302, `/renderer/v1/parcel/${r.rows[0].id}.html`)
        }
      }
    }

    const islands = await Islands.fetch()

    const windowTitle = isProduction ? 'Voxels' : '⚙️ Voxels local'
    const head = (
      <head>
        <title>{windowTitle}</title>
        <JsonData id="islands" data={islands} />
      </head>
    )

    res.send(renderComponent(head))
  })
}
