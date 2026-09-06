# Kernel

Client architecture for Voxels. Read this before touching mesh code, workers, or bundle size.

## The knob

All geometry is one pipeline with different pre/post passes:

```
.vox bytes  ──> parse to field ──┐
                                 ├──> mesh (typed arrays) ──> GPU / Babylon / lite
parcel field ──> optional light ─┘
```

**Not separate systems.** These are the same job in different costumes:

| File | Status |
|------|--------|
| `src/monoworker/mesh.ts` | canonical mesher |
| `src/monoworker/lightmap.ts` | light pass + calls mesh |
| `src/monoworker/vox.ts` | .vox parse + calls mesh |
| `common/vox-import/vox-reader.ts` | deleted (was ao-mesher) |
| `common/voxels/mesher.ts` | thin wrapper -> worker |
| `common/vox-import/sync-vox-import.ts` | deleted (was main-thread duplicate) |

The webpack chunk named `format-vox` was mostly **ao-mesher + cwise + ndarray**, not the 27kb parser.

## Rules

1. **Typed arrays at worker boundaries.** No Babylon, no scene, no classes cross the worker line.
2. **~10 npm modules on the hot path.** Hand-roll or lazy-load everything else.
3. **Earn your bytes.** New code attaches to `field -> MeshOut` or preact overlay only.
4. **One worker mesh API.** `src/monoworker.ts` is the compute surface.
5. **Delete duplicate paths.** No third mesher. No sync main-thread mesh.

## MeshOut contract

Vox and parcel mesh paths converge on byte buffers at worker boundaries:

```ts
type MeshBuf = {
  pos: Int8Array      // mesh-local grid coords
  rgb: Uint8Array     // n*3 vertex color
  idx: Uint16Array | Uint32Array
  meta: { ox, oy, oz, scale }  // worldPos = origin + pos * scale
  lit?: Uint8Array    // parcel palette drag
  ci?: Uint8Array
  uv?: Uint8Array
}
```

- **Vox**: `scale = 0.02`, shader derives normals in fragment stage (`vox.fsh`).
- **Parcel**: still float `Geo` / `LightmapOut` until `clean-mesher` migrates (`scale = 0.5`).

Upload: `common/mesh/upload.ts` `applyMeshBuf()`. Lite/thumb expand bytes via `expandMeshBuf()`.

Legacy parcel shape (being replaced):

```ts
type MeshOut = {
  opaque: { positions, normals, indices, colors, colorIndices?, uvs? }
  glass: { positions, normals, indices, colorIndices? } | null
  collider?: Int32Array
}
```

## npm budget (hot path)

| Keep (lazy ok) | Kill or inline |
|----------------|----------------|
| preact | ao-mesher + cwise stack |
| @babylonjs/lite | lodash |
| rapier WASM | io-ts / fp-ts on client |
| comlink (short term) | sync main-thread mesh |
| wasmoon (worker, later) | duplicate workers (merge later) |
| livekit (showbox only) | format-vox (hand parser) |

## PR checklist

- [x] PR0: this doc
- [x] PR1: single monoworker mesher, kill ao-mesher
- [x] PR2: hand vox parser, drop format-vox npm
- [x] PR3: delete sync-vox-import
- [x] PR4: stop main-thread monoworker graph leak

Measure prod webpack after each PR. Update this checklist.

## Reference

`src/monoworker/lightmap.ts` comment: "Zero BABYLON." Hand-rolled greedy mesh, typed arrays end-to-end. That is the mesher everything else delegates to.
