/** Parse GLB JSON chunk; map VRM 0.x humanoid bone name -> node name. No gltf-transform. */
export function humanoidBones(bytes: ArrayBuffer): Record<string, string> {
  const view = new DataView(bytes)
  if (view.getUint32(0, true) !== 0x46546c67) return {} // glTF
  const jsonLen = view.getUint32(12, true)
  const jsonType = view.getUint32(16, true)
  if (jsonType !== 0x4e4f534a) return {} // JSON
  const json = new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLen))
  let gltf: any
  try {
    gltf = JSON.parse(json)
  } catch {
    return {}
  }
  // 0.x: humanBones is an array of { bone, node }
  const bones = gltf?.extensions?.VRM?.humanoid?.humanBones
  if (!Array.isArray(bones) || !gltf.nodes) return {}
  const out: Record<string, string> = {}
  for (const entry of bones) {
    if (entry?.node == null || !entry?.bone) continue
    const node = gltf.nodes[entry.node]
    if (node?.name) out[entry.bone] = node.name
  }
  return out
}
