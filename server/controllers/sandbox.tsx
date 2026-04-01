import { h } from 'preact'
import ClientRoot from '../../web/src/client-root'
import JsonData from '../../web/src/components/json-data'
import renderRoot from '../handlers/render-root'
import { Express } from 'express'

const space = {
  id: 0,
  spaceId: 'sandbox',
  name: 'Dev Sandbox',
  owner: 'dev',
  owner_name: '',
  width: 24,
  height: 16,
  depth: 24,
  x1: 0,
  y1: 0,
  z1: 0,
  x2: 24,
  y2: 16,
  z2: 24,
  settings: { sandbox: true },
  content: { features: [], voxels: '' },
  hash: 'sandbox',
  lightmap_url: null,
  parcel_users: [],
  is_common: false,
  kind: 'sandbox',
}

export default function SandboxController(app: Express) {
  app.get('/spaces/sandbox/play', (_req, res) => {
    const html = (
      <ClientRoot title="Voxels Dev Sandbox" ogTitle="Dev Sandbox" ogDescription="Build stuff">
        <JsonData id="space" data={{ ...space, voxels: '' }} dataId="sandbox" />
      </ClientRoot>
    )
    res.send(renderRoot(html))
  })
}
