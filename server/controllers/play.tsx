import { h } from 'preact'
import JsonData from '../../web/src/components/json-data'
import cache from '../cache'
import renderComponent from '../handlers/render-component'
import { Islands } from '../islands'
import Parcel from '../parcel'
import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { Express } from 'express'
import 'babylonjs' // BABYLON
const isProduction = process.env.NODE_ENV === 'production'

export default function PlayController(db: Db, passport: PassportStatic, app: Express) {
  app.get('/play', cache('60 seconds'), passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req, res) => {
    const islands = await Islands.fetch()

    let parcel: Parcel | null = null

    // user was rejected from a parcel, fastboot it so the bouncer UI can show the kickout message
    if (req.query.rejectedFrom && !isNaN(parseInt(req.query.rejectedFrom as string))) {
      try {
        parcel = await Parcel.load(parseInt(req.query.rejectedFrom as string))
      } catch (e) {
        parcel = null
      }
    }

    const windowTitle = isProduction ? 'Voxels' : '⚙️ Voxels local'
    const summary = parcel?.summary || {}

    // THE GREAT MERGE: serve the one web shell. Fastboot JSON goes in <head> so the
    // web bundle's body hydration doesn't strip it before the engine reads it.
    const head = (
      <head>
        <title>{windowTitle}</title>
        <JsonData id="islands" data={islands} />
        {!!parcel && <JsonData id="parcel" data={summary} dataId={parcel.id} />}
      </head>
    )

    res.send(renderComponent(head))
  })
}
