#!/bin/bash

# Usage:
#   ./dump.sh              # data only (safe for prod)
#   ./dump.sh --yolo       # also dumps schema into import.sql + schema.sql
#
# Set DATABASE_URL to point at a different db, e.g.:
#   DATABASE_URL=postgresql://user:pass@host/dbname ./dump.sh

DB="${DATABASE_URL:-voxels}"
OUTPUT_FILE="import.sql"
ISLAND_NAME="Poneke"

# Enforce read-only on every connection - safe to point at prod
export PGOPTIONS='--default-transaction-read-only=on'

echo "-- Generating Poneke Dev Fixture (db=$DB) --"

cat <<EOF > $OUTPUT_FILE
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

EOF

pg_dump "$DB" -s --no-owner --no-privileges \
  | grep -v -E '^(--|SET|SELECT pg_catalog\.set_config|/\*)' \
  | sed '/^$/d' \
  > schema.sql

pg_dump "$DB" -s --no-owner --no-privileges >> $OUTPUT_FILE

cat <<EOF >> $OUTPUT_FILE
SET session_replication_role = 'replica';
BEGIN;

EOF

dump_table() {
    local table_name=$1
    local query=$2

    echo "Processing data for $table_name..."
    echo "COPY public.$table_name FROM STDIN WITH (FORMAT CSV, HEADER);" >> $OUTPUT_FILE
    psql "$DB" -c "COPY ($query) TO STDOUT WITH (FORMAT CSV, HEADER)" >> $OUTPUT_FILE
    echo "\." >> $OUTPUT_FILE
    echo "" >> $OUTPUT_FILE
}

dump_table "islands" "SELECT * FROM islands"
dump_table "properties" "SELECT * FROM properties WHERE island = '$ISLAND_NAME'"
dump_table "womps" "SELECT w.* FROM womps w JOIN properties p ON w.parcel_id = p.id WHERE p.island = '$ISLAND_NAME'"

dump_table "avatars" "
  SELECT DISTINCT ON (a.id) a.* FROM avatars a
  WHERE lower(a.owner) IN (
    SELECT DISTINCT lower(owner) FROM properties WHERE island = '$ISLAND_NAME'
    UNION
    SELECT DISTINCT lower(author) FROM womps w
    JOIN properties p ON w.parcel_id = p.id
    WHERE p.island = '$ISLAND_NAME'
    UNION
    SELECT DISTINCT lower(pu.wallet) FROM parcel_users pu
    JOIN properties p ON pu.parcel_id = p.id
    WHERE p.island = '$ISLAND_NAME'
  )
"

dump_table "costumes" "
  SELECT c.* FROM costumes c
  WHERE LOWER(c.wallet) IN (
    SELECT DISTINCT LOWER(owner) FROM properties WHERE island = '$ISLAND_NAME'
    UNION
    SELECT DISTINCT LOWER(author) FROM womps w
    JOIN properties p ON w.parcel_id = p.id
    WHERE p.island = '$ISLAND_NAME'
  )
"

# bnolan wearables (costumes already captured above via Poneke dump)
dump_table "wearables" "SELECT DISTINCT ON (w.id) w.* FROM wearables w JOIN (SELECT e->>'wid' AS wid FROM costumes c JOIN avatars a ON lower(a.owner) = lower(c.wallet) CROSS JOIN LATERAL jsonb_array_elements(c.attachments::jsonb) e WHERE a.name = 'bnolan') wids ON w.id::text = wids.wid"
dump_table "collections" "SELECT DISTINCT ON (col.id) col.* FROM collections col JOIN wearables w ON w.collection_id = col.id JOIN (SELECT e->>'wid' AS wid FROM costumes c JOIN avatars a ON lower(a.owner) = lower(c.wallet) CROSS JOIN LATERAL jsonb_array_elements(c.attachments::jsonb) e WHERE a.name = 'bnolan') wids ON w.id::text = wids.wid"
dump_table "parcel_users" "SELECT pu.* FROM parcel_users pu JOIN properties p ON pu.parcel_id = p.id WHERE p.island = '$ISLAND_NAME'"
dump_table "asset_library" "SELECT * FROM asset_library WHERE name ILIKE '%fish%' OR name ILIKE '%toilet%'"

cat <<EOF >> $OUTPUT_FILE
COMMIT;
SET session_replication_role = 'origin';
EOF

# Gzip the output file
gzip -f $OUTPUT_FILE

echo "-- Done! Created $OUTPUT_FILE.gz --"
echo "Usage: createdb voxels && psql voxels < $OUTPUT_FILE.gz"
