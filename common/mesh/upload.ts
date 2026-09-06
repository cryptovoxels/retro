// ABOUTME: Upload MeshBuf to Babylon with byte vertex attrs + meta uniforms on shader.

import type { MeshBuf } from './buf'

// Babylon 6.11: 7th VertexBuffer ctor arg is instanced, not useBytes.
function byteVB(engine: BABYLON.Engine, data: BABYLON.DataArray, kind: string, comps = 3) {
  const buf = new BABYLON.Buffer(engine, data, false, comps, false, false, true)
  return buf.createVertexBuffer(kind, 0, comps, comps, false, true)
}

function meshBufOk(buf: MeshBuf) {
  const n = buf.pos.length / 3
  if (!n || buf.rgb.length / 3 !== n) return false
  let max = 0
  for (let i = 0; i < buf.idx.length; i++) max = Math.max(max, buf.idx[i])
  if (max >= n) {
    console.error('mesh buf mismatch', { n, max })
    return false
  }
  return true
}

function dbgLog(location: string, message: string, data: Record<string, unknown>, hypothesisId: string) {
  // #region agent log
  fetch('http://127.0.0.1:7655/ingest/53bfc83e-fc60-46e1-b593-0d715a1e3f0d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '23c1af' },
    body: JSON.stringify({ sessionId: '23c1af', runId: 'pre-fix', hypothesisId, location, message, data, timestamp: Date.now() }),
  }).catch(() => {})
  // #endregion
}

export function applyMeshBuf(mesh: BABYLON.Mesh, buf: MeshBuf, mat?: BABYLON.ShaderMaterial) {
  const ok = meshBufOk(buf)
  const n = buf.pos?.length ? buf.pos.length / 3 : 0
  let maxIdx = 0
  if (buf.idx?.length) for (let i = 0; i < buf.idx.length; i++) maxIdx = Math.max(maxIdx, buf.idx[i])
  dbgLog('upload.ts:applyMeshBuf:entry', 'applyMeshBuf called', {
    meshName: mesh.name,
    ok,
    vertCount: n,
    posLen: buf.pos?.length ?? 0,
    rgbLen: buf.rgb?.length ?? 0,
    idxLen: buf.idx?.length ?? 0,
    maxIdx,
    posType: buf.pos?.constructor?.name ?? typeof buf.pos,
    rgbType: buf.rgb?.constructor?.name ?? typeof buf.rgb,
    idxType: buf.idx?.constructor?.name ?? typeof buf.idx,
    meta: buf.meta,
  }, 'H1')
  if (!ok) {
    dbgLog('upload.ts:applyMeshBuf:bail', 'meshBufOk rejected buffer', { meshName: mesh.name, vertCount: n, maxIdx }, 'H2')
    return
  }

  const engine = mesh.getEngine()
  const posVB = byteVB(engine, buf.pos, BABYLON.VertexBuffer.PositionKind)
  const rgbVB = byteVB(engine, buf.rgb, 'color')
  dbgLog('upload.ts:applyMeshBuf:vb', 'vertex buffers created', {
    meshName: mesh.name,
    posByteStride: (posVB as any).byteStride,
    posSize: (posVB as any)._size,
    posType: (posVB as any).type,
    posInstanced: posVB.isInstanced?.(),
    rgbByteStride: (rgbVB as any).byteStride,
    rgbType: (rgbVB as any).type,
  }, 'H3')
  mesh.setVerticesBuffer(posVB)
  mesh.setVerticesBuffer(rgbVB)
  mesh.setIndices(Array.from(buf.idx))

  if (mat) {
    mat.setVector3('meshOrigin', new BABYLON.Vector3(buf.meta.ox, buf.meta.oy, buf.meta.oz))
    mat.setFloat('meshScale', buf.meta.scale)
  }

  if (buf.lit?.length) mesh.setVerticesBuffer(byteVB(engine, buf.lit, 'lit', 1))
  if (buf.ci?.length) mesh.setVerticesBuffer(byteVB(engine, buf.ci, 'ci', 1))
  if (buf.uv?.length) mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, buf.uv as any, false, 2)

  mesh.refreshBoundingInfo()
}

export function expandMeshBuf(buf: MeshBuf) {
  const n = buf.pos.length / 3
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 4)
  const { ox, oy, oz, scale } = buf.meta
  for (let i = 0; i < n; i++) {
    const o = i * 3
    positions[o] = ox + buf.pos[o] * scale
    positions[o + 1] = oy + buf.pos[o + 1] * scale
    positions[o + 2] = oz + buf.pos[o + 2] * scale
    const c = i * 4
    colors[c] = buf.rgb[o] / 255
    colors[c + 1] = buf.rgb[o + 1] / 255
    colors[c + 2] = buf.rgb[o + 2] / 255
    colors[c + 3] = 1
  }
  return { positions, colors, indices: buf.idx }
}
