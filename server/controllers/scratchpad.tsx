import { h } from 'preact'
import ClientRoot from '../../web/src/client-root'
import JsonData from '../../web/src/components/json-data'
import cache from '../cache'
import renderRoot from '../handlers/render-root'
import { Islands } from '../islands'
import Parcel from '../parcel'
import db from '../pg'
import { Express } from 'express'

const isProduction = process.env.NODE_ENV === 'production'

async function loadScratchpadParcel(): Promise<Parcel | null> {
  const result = await db.query(
    'embedded/get-scratchpad',
    `select id from properties where kind = 'scratchpad' limit 1`,
    []
  )
  const id = result?.rows[0]?.id
  if (!id) return null
  return Parcel.load(id)
}

export default function ScratchpadController(app: Express) {
  app.get('/scratchpad', cache('60 seconds'), async (_req, res) => {
    const parcel = await loadScratchpadParcel()

    if (!parcel) {
      res.redirect('/play')
      return
    }

    const islands = await Islands.fetch()
    const windowTitle = isProduction ? 'Scratchpad | Voxels' : 'Scratchpad | Voxels local'

    const html = (
      <ClientRoot title={windowTitle} ogTitle="Scratchpad | Voxels" ogDescription="A publicly editable parcel for everyone.">
        <JsonData id="islands" data={islands} />
        <JsonData id="parcel" data={parcel.summary} dataId={parcel.id} />
      </ClientRoot>
    )

    res.send(renderRoot(html))
  })
}
