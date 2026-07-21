#!/bin/bash
# Dump all parcel content to NDJSON for the world-dump CAS tool.
#
# Usage:
#   ./db/dump-parcels-json.sh
#   DATABASE_URL=postgres://localhost/voxels ./db/dump-parcels-json.sh
#   OUT=./tools/world-dump/tmp/parcels.ndjson ./db/dump-parcels-json.sh

set -euo pipefail

DB="${DATABASE_URL:-voxels}"
OUT="${OUT:-parcels.ndjson}"

export PGOPTIONS='--default-transaction-read-only=on'

mkdir -p "$(dirname "$OUT")"

echo "-- Dumping parcels to $OUT (db=$DB) --"

# Do not use COPY text format here. It escapes backslashes and corrupts JSON.
# json_build_object keeps content as JSON and escapes field newlines as \n.
psql "$DB" -t -A -v ON_ERROR_STOP=1 -c "
  SELECT json_build_object(
    'id', p.id,
    'name', p.name,
    'address', p.address,
    'island', p.island,
    'lightmap_url', p.lightmap_url,
    'content', COALESCE(p.content, '{}'::json)
  )::text
  FROM properties p
  WHERE p.content IS NOT NULL
    AND p.content::text != '{}'
    AND p.content::text != 'null'
  ORDER BY p.id
" > "$OUT"

LINES=$(wc -l < "$OUT" | tr -d ' ')
echo "-- Done! $LINES parcels -> $OUT --"
echo "Optional: gzip -f $OUT"
