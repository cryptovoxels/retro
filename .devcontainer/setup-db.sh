#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# The db service creates POSTGRES_DB=voxels with trust auth, so there is
# nothing to create here and no password to pass.
export DATABASE_URL="${DATABASE_URL:-postgres://postgres@db:5432/voxels}"

echo "Waiting for PostgreSQL..."
until pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; do sleep 1; done

if psql "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'properties'" | grep -q 1; then
  echo "Database already has public.properties; skip db/import.sql.gz"
  exit 0
fi

echo "Loading db/import.sql.gz (first-time seed)..."
gunzip -c db/import.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
echo "Database import done."
