import { h } from 'preact'
import JsonData from '../../web/src/components/json-data'
import cache from '../cache'
import renderComponent from '../handlers/render-component'
import { Islands } from '../islands'
import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { Express } from 'express'
import 'babylonjs' // BABYLON
const isProduction = process.env.NODE_ENV === 'production'

export default function PlayController(db: Db, passport: PassportStatic, app: Express) {
  app.get('/play', cache('60 seconds'), passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req, res) => {
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
