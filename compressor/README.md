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
only. Limits: 16 MiB source, 16 megapixels decoded, four concurrent jobs shared with `/compressed`.
Jobs have a two-second deadline including queue time. Network and storage
requests abort at the deadline; native encoders are killed with SIGKILL.
Sharp operations also have a one-second processing timeout. Slow images fail
instead of holding up the queue. ASTC uses fast quality.
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

Runs on port 9473. Requires `linux/amd64` for the bundled Crunch binary. The image installs
PVRTexTool 5.7.1 (2026 R1) from Imagination with a pinned SHA-256 checksum.
PVRTexTool runs with one encoder thread per job. Local development needs
`PVRTexToolCLI` on PATH, or `PVRTEXTOOL` set to its executable path.

This product includes components of the PowerVR Tools Software from
Imagination Technologies Limited.
[PowerVR Tools licence](https://developer.imaginationtech.com/terms/software-end-user-licence-agreement/).

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
