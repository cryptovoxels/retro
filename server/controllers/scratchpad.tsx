import { h } from 'preact'
import ClientRoot from '../../web/src/client-root'
import JsonData from '../../web/src/components/json-data'
import renderRoot from '../handlers/render-root'
import { Express } from 'express'

const space = {
  id: 0,
  spaceId: 'scratchpad',
  name: 'Scratchpad',
  owner: 'dev',
  owner_name: '',
  width: 14,
  height: 12,
  depth: 20,
  x1: 0,
  y1: 0,
  z1: 0,
  x2: 14,
  y2: 12,
  z2: 20,
  settings: { sandbox: true },
  content: { features: [], voxels: '' },
  hash: 'scratchpad',
  lightmap_url: null,
  parcel_users: [],
  is_common: false,
  kind: 'scratchpad',
}

export default function ScratchpadController(app: Express) {
  app.get('/scratchpad', (_req, res) => {
    const html = (
      <ClientRoot title="Voxels Scratchpad" ogTitle="Scratchpad" ogDescription="Build stuff">
        <JsonData id="space" data={{ ...space, voxels: '' }} dataId="scratchpad" />
      </ClientRoot>
    )
    res.send(renderRoot(html))
  })
}
