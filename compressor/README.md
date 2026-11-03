# Texture Compressor

Converts images to GPU-compressed texture formats (DXT, ETC, PVRTC, ASTC) and uploads to S3.

## API

**GET /compressed**

| Param | Description |
|-------|-------------|
| `url` | Source image URL (required) |
| `hint` | Output format: `.dxt.ktx`, `.etc.ktx`, `.pvrtc.ktx`, `.astc.ktx` |
| `mode` | `color` or `transparent` |
| `size` | Max dimension in pixels |
| `stretch` | `true` to stretch non-square images |
| `gif` | `sheet` (sprite sheet) or `first` (first frame only) |

Returns 301 redirect to the compressed texture on S3.

**GET https://compressed.voxels.com/{key}**

Replace `ugc.voxels.com` with `compressed.voxels.com` for a 256px WebP.
Append `?hint=.astc.ktx` for ASTC 8x8 KTX with mipmaps on supported GPUs.
The legacy `/mobile?key=...` URL also works. Other hints are rejected.

Results live beside the original in `voxels-ugc` (syd1):
`{key}.mobile-v1.webp` or `{key}.mobile-v1.astc.ktx`.
A bucket HEAD checks for an existing result. Cache hits redirect immediately;
misses download, resize, encode, upload publicly, then redirect to `ugc.voxels.com`.
Originals are never overwritten. Use immutable UGC keys.

Fits within 256x256 without enlargement, preserves alpha, first animation frame
only. Limits: 16 MiB source, 16 megapixels decoded, two concurrent conversions.
Responses have a one-year cache. Unsupported/oversized images fail without
falling back to the original on mobile.

Runs in the `retrovoxels` DigitalOcean App Platform app (sfo), component
`compressor`, using `compressor/Dockerfile` (Linux amd64). App-level `UGC_ACCESS`
and `UGC_SECRET` provide bucket access. Deploy the compressor before the client.

## Development

```bash
# Create .env with S3 credentials
cp .env.example .env

# Run locally
npm run compressor:dev
```

## Docker

```bash
cd compressor
docker compose up --build
```

Runs on port 9473. Requires `linux/amd64` platform for texture-compressor binaries.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 9473) |
| `DO_SPACE_REGION` | S3 region |
| `DO_SPACE_NAME` | Bucket name |
| `DO_SPACE_KEY` | Access key |
| `DO_SPACE_SECRET` | Secret key |
| `DO_SPACE_ENDPOINT` | S3 endpoint URL |
| `DO_CDN_HOST` | CDN URL for redirects |
