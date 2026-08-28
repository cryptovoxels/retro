#!/usr/bin/env node
/**
 * Rename mixamorig:BoneName -> bonename in avatar + animation GLBs.
 * Channels bind by node index, so renaming is safe if everything is renamed together.
 */
import { NodeIO } from '@gltf-transform/core'
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const ROOT = new URL('..', import.meta.url).pathname
const FILES = [
  'dist/models/avatar.glb',
  'dist/models/avatar-all-actions.glb',
  ...readdirSync(join(ROOT, 'dist/animations'))
    .filter((f) => f.endsWith('.glb'))
    .map((f) => `dist/animations/${f}`),
]

function stripName(name) {
  if (!name.includes(':')) return name
  return name.split(':').pop().toLowerCase()
}

function bumpManifest(glbPath) {
  const path = glbPath + '.manifest'
  try {
    const m = JSON.parse(readFileSync(join(ROOT, path), 'utf8'))
    m.version = (m.version || 0) + 1
    writeFileSync(join(ROOT, path), JSON.stringify(m, null, 2) + '\n')
    console.log(`  bumped ${path} -> v${m.version}`)
  } catch {
    // no manifest, fine
  }
}

const io = new NodeIO()

for (const rel of FILES) {
  const abs = join(ROOT, rel)
  const doc = await io.read(abs)
  let n = 0
  for (const node of doc.getRoot().listNodes()) {
    const before = node.getName()
    const after = stripName(before)
    if (before !== after) {
      node.setName(after)
      n++
    }
  }
  // skin joints may also carry names via nodes already; skins themselves don't rename
  await io.write(abs, doc)
  console.log(`${rel}: renamed ${n} nodes`)
  bumpManifest(rel)
}
