# UGC compression Function trial

DigitalOcean Function `textures/compress` in the `voxels` namespace (sfo3).
The existing compressor remains the fallback and handles other formats and sources.

The engine uses this path by default for
static UGC images on ASTC-capable devices, including Apple Silicon Macs.
GIFs, external images and other GPU formats keep their existing routing.
Add `&textureFunction=0` and reload to disable the Function trial.

Input: `key=parcel/6822/YfJx2r.jpg&width=256&height=256&fit=cover&format=astc`.
Only UGC parcel image keys are accepted; no arbitrary URLs.
Resize parameter names follow KeyCDN: `width`, `height`, `fit`.
Supported widths/heights: 128, 256, 512. Fits: cover, contain, fill.
Format: astc (ASTC 4x4 KTX with a full mip chain).
Pixels are flipped for Babylon's compressed texture upload convention.

Destination in the texture bucket:
`parcel/6822/YfJx2r.jpg/width=256,height=256,fit=cover,format=astc.ktx`.
The engine calls the Function, which redirects only to objects confirmed in the bucket.
The Function checks the bucket, compresses and uploads on a miss, and redirects
to the CDN. Failures return 503 with Retry-After: 30; the engine falls back to
the existing compressor. DO supplies CORS headers for web Functions.

## deploy

Use the pinned PVRTexTool 5.7.1 Linux binary from the existing compressor build:

```sh
./compressor/function/prepare.sh /path/to/CLI/Linux_x86_64/PVRTexToolCLI
doctl serverless connect fn-7f487c48-1176-4b03-82aa-03c5faebe781
doctl serverless deploy compressor/function --remote-build --env /private/path/texture-function.env
```

The private environment file supplies TEXTURE_STORAGE_ENDPOINT, TEXTURE_STORAGE_REGION,
TEXTURE_STORAGE_BUCKET, TEXTURE_STORAGE_KEY and TEXTURE_STORAGE_SECRET from the
existing compressor. Never commit it. The destination bucket is texturetest.
Remote builds install Sharp and the S3 SDK for Linux. The encoder binary and
installed dependencies are excluded from git. Runtime: Node 24, 1 GB memory,
30 second invocation limit, 10 second download/encoding limits.

## measured trial: 2026-11-04

Real UGC source: `parcel/6822/YfJx2r.jpg`.
Initial encoding-only invocation: 202 ms work, 683 ms runtime initialization,
240 MiB peak RSS. Four parallel invocations succeeded: 144-301 ms work.
256px output: 87,536 bytes, 9 mips. 512px: 349,684 bytes, 10 mips.
Bucket upload and CDN retrieval verified with a valid KTX header.
This is a small feasibility test, not a production load benchmark.
