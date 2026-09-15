// ABOUTME: Background parcel compiler - rehosts assets to UGC, copies KTX sidecars, encodes drafts.

import './bootstrap'
import express from 'express'
import { compileParcelContent } from '../../common/helpers/parcel-compile'
import Parcel from '../../server/parcel'
import db from '../../server/pg'
import { encodeImageDraft, encodeVoxDraft } from './drafts'
import { serverUpload } from './upload'

const port = process.env.PORT || '8081'
const SLEEP_MS = parseInt(process.env.COMPILE_SLEEP_MS || '5000', 10)

const app = express()

app.get('/health', (_req, res) => {
  res.status(200).end('up')
})

async function pickParcelId(): Promise<number | null> {
  const r = await db.query('embedded/pick-uncompiled-parcel', `select id from properties where content::text not like '%ugc://parcel/%' order by random() limit 1`)
  const id = r.rows[0]?.id
  return typeof id === 'number' ? id : null
}

function applyPatch(content: any, patch: Awaited<ReturnType<typeof compileParcelContent>>) {
  if (patch.features && Array.isArray(content.features)) {
    for (const f of content.features) {
      if (f?.uuid && patch.features[f.uuid]) Object.assign(f, patch.features[f.uuid])
    }
  }
  if (patch.tileset !== undefined) content.tileset = patch.tileset
}

async function compileOne(id: number) {
  const parcel = await Parcel.load(id)
  if (!parcel?.content) return

  const features = (parcel.content.features || []).filter((f: any) => f && f.uuid)
  const tileset = parcel.content.tileset as string | undefined
  const upload = (name: string, bytes: Uint8Array, contentType: string) => serverUpload(id, name, bytes, contentType)

  const patch = await compileParcelContent(id, features, tileset, upload, {
    encodeImage: encodeImageDraft,
    encodeVox: encodeVoxDraft,
  })

  if (!patch.features && patch.tileset === undefined) return

  applyPatch(parcel.content, patch)
  parcel.setContent(parcel.content)
  await parcel.save()
  console.log('[compiler] compiled parcel', id)
}

async function loop() {
  for (;;) {
    try {
      const id = await pickParcelId()
      if (id) await compileOne(id)
    } catch (e) {
      console.error('[compiler]', e)
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS))
  }
}

app.listen(port, () => {
  console.log('[compiler] listening on', port)
  void loop()
})
