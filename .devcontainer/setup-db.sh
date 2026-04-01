#!/usr/bin/env bash
set -euo pipefail
cd /workspaces/retro

export DATABASE_URL="${DATABASE_URL:-postgres://localhost:5432/voxels}"

createdb voxels

echo "Waiting for PostgreSQL..."
until pg_isready -h db -U voxels -d voxels >/dev/null 2>&1; do sleep 1; done

if psql "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'properties'" | grep -q 1; then
  echo "Database already has public.properties; skip db/import.sql"
  exit 0
fi

echo "Loading db/import.sql (first-time seed)..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/import.sql
echo "Database import done."
