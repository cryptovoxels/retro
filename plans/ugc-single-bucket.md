# ugc -> single bucket migration

by: ben
authored: 2026-06-20
complete: no
migration notes: nil

## what this was

A migration that pulls all parcel user content (images, vox models, audio, video,
lightmaps, tilesets) out of the sprawl of voxels-owned services and external user
links, and consolidates it into one bucket: the `voxels-ugc` DO Space, served via
`https://ugc.crvox.com`. Keys are `parcel-<id>/<sha1><ext>`. The parcel scene JSON
(`properties.content`) gets rewritten in place to point only at that host. Run
per island, idempotent, with a `--dry-run` mode.

## why we did it

- We were fetching the same content from a dozen different hosts/proxies
  (compressor, img, herring, proxy, media, files, cdn2, plus discord/reddit/dropbox/ipfs).
  One bucket = one cdn, one cache, one place to reason about, no flaky third parties.
- Images get converted to a GPU-native format up front (ETC1S `.ktx2`) so we drop
  the runtime compressor service entirely, plus a `.webp` for close-up detail.
- We bake instant far-away placeholders into the JSON so distant parcels paint
  immediately with zero network fetches (LQIP for parcels).

## services replaced (consolidated into ugc.crvox.com)

- `compressor.cryptovoxels.com` + `textures.sfo2.cdn.digitaloceanspaces.com` - texture compression + cdn
- `img.cryptovoxels.com` (`IMG_URL`/`IMG_HOST`) - audio/video-poster/particle/tileset proxy
- `herring.crvox.com` (`VOX_URL`) - vox-model / megavox / collectible-model proxy
- `media.crvox.com` / `media-crvox.sfo2` + `upload.media.crvox.com` - user uploads
- `files.crvox.com` / `cryptovoxels.sfo2` (`SPACES_BUCKET`) - lightmaps
- external user hosts fetched live: discord, reddit, dropbox, ipfs.io (mirrored in)

left live (out of scope): `proxy.crvox.com` + `cdn2.cryptovoxels.com` opensea/nft
(dynamic), `bake.voxels.com`, `sounds.crvox.com`, `broadcast.cryptovoxels.com`,
`wearables.crvox.com`, `map.voxels.com`, `render.voxels.com`. nft-image only migrated
if its url is a concrete static image; opensea.io permalinks are skipped.

## what the script does per asset

- images (image/cube/particles/portal/nft-image/video-preview/womp): download ->
  `.ktx2` (ETC1S, 512x512, via `basisu`) + `.webp` (2k max side) stored side by side,
  url rewritten to the extensionless base key.
- vox (vox-model/megavox/collectible-model): copy the `.vox` as-is.
- audio/video/tileset/lightmap: copy as-is. 100MB cap (skip + log over the limit).
- discord cdn: refresh expired signed urls via `POST /attachments/refresh-urls`
  (needs `DISCORD_BOT_TOKEN`), soft-fail to skip if no token.
- idempotent: skips urls already on ugc.crvox.com and keys that already exist;
  per-parcel dedup memo; appends a JSONL manifest for audit/rollback/resume.

## embedded far-LOD placeholders (baked into the JSON)

- images: 8x8 low-quality jpeg as a base64 data uri on `feature.thumb` (~200-400 bytes).
- vox: parse the model, downsample to a 4x4x4 grid, 1 byte per cell = index into a
  fixed shared palette, base64 on `feature.lod4` (~88 chars).
- palette is a fixed 6x6x6 web-safe cube (`common/vox-palette.ts`), shared by the
  script and the future client render. index 0 = empty.

## files

- `common/vox-palette.ts` - shared fixed palette + O(1) nearest-index.
- `scripts/lib/ugc-migrate.ts` - download/convert/upload, vox parser + 4x4x4 LOD,
  discord refresh, s3 put/head, `rewriteParcel()`.
- `scripts/migrate-island-assets.ts` - cli + per-island parcel loop.

## how to run

```bash
# dry run first (read-only, no downloads/uploads, writes a manifest)
DATABASE_URL=postgres://... tsx scripts/migrate-island-assets.ts --island="Little Ceres" --dry-run

# live (mutates the bucket + db)
DATABASE_URL=postgres://... UGC_SECRET=... DISCORD_BOT_TOKEN=... \
  tsx scripts/migrate-island-assets.ts --island="Little Ceres" --concurrency=4
```

flags: `--island="Name"`, `--parcel=ID`, `--limit=N`, `--concurrency=N`, `--dry-run`.
needs `basisu` on PATH.

## still to do (phase 2, client)

The script writes the new bucket urls + placeholders, but the client doesn't consume
them yet. Phase 2:

- register the babylon ktx2 transcoder (`KhronosTextureContainer2.URLConfig`) + host
  `basis_transcoder.wasm/.js`.
- `src/textures/textures.ts` / `image.tsx`: load `<base>.ktx2` first, swap to
  `<base>.webp` when the camera is close; retire the compressor url builders.
- far-LOD render: paint `feature.thumb` on distant image planes and render the
  4x4x4 `feature.lod4` cubes for distant vox, promote to full asset as you approach.
- `content.tileset` now holds an absolute url, so `voxel-field` must stop prepending
  `IMG_HOST` for migrated parcels.
