#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
: "${UGC_ACCESS:?}" "${UGC_SECRET:?}"
export REHOST_TOKEN="$(node -e "process.stdout.write(require('node:crypto').createHmac('sha256',process.env.UGC_SECRET).update('parcels/rehost').digest('hex'))")"
pnpm exec esbuild compiler/function/rehost.ts --bundle --platform=node --target=node24 --format=cjs --minify --external:sharp --outfile=compiler/function/packages/parcels/rehost/index.js
doctl serverless deploy compiler/function --remote-build
