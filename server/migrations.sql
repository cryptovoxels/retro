 -- This file provides a method for applying incremental schema changes
-- to a PostgreSQL database.

-- Add your migrations at the end of the file, and run "psql -v ON_ERROR_STOP=1 -1f
-- migrations.sql yourdbname" to apply all pending migrations. The
-- "-1" causes all the changes to be applied atomically

-- Most Rails (ie. ActiveRecord) migrations are run by a user with
-- full read-write access to both the schema and its contents, which
-- isn't ideal. You'd generally run this file as a database owner, and
-- the contained migrations would grant access to less-privileged
-- application-level users as appropriate.

-- Refer to https://github.com/purcell/postgresql-migrations for info and updates

--------------------------------------------------------------------------------
-- A function that will apply an individual migration
--------------------------------------------------------------------------------
DO
$body$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_proc WHERE proname = 'apply_migration') THEN
    CREATE FUNCTION apply_migration (migration_name TEXT, ddl TEXT) RETURNS BOOLEAN
      AS $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_tables WHERE tablename = 'applied_migrations') THEN
        CREATE TABLE applied_migrations (
            identifier TEXT NOT NULL PRIMARY KEY
          , ddl TEXT NOT NULL
          , applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
      END IF;
      LOCK TABLE applied_migrations IN EXCLUSIVE MODE;
      IF NOT EXISTS (SELECT 1 FROM applied_migrations m WHERE m.identifier = migration_name)
      THEN
        RAISE NOTICE 'Applying migration: %', migration_name;
        EXECUTE ddl;
        INSERT INTO applied_migrations (identifier, ddl) VALUES (migration_name, ddl);
        RETURN TRUE;
      END IF;
      RETURN FALSE;
    END;
    $$ LANGUAGE plpgsql;
  END IF;
END
$body$;

--------------------------------------------------------------------------------
-- Lots of migrations removed
--------------------------------------------------------------------------------


-- select apply_migration('remove-postgis-footprint-bounds-json',
-- $$
--   CREATE EXTENSION IF NOT EXISTS cube;

--   ALTER TABLE islands ADD COLUMN IF NOT EXISTS holes_geometry_json jsonb;
--   ALTER TABLE islands ADD COLUMN IF NOT EXISTS lakes_geometry_json jsonb;
--   ALTER TABLE islands ADD COLUMN IF NOT EXISTS content json;
--   ALTER TABLE islands ADD COLUMN IF NOT EXISTS other_name text;

--   ALTER TABLE properties ADD COLUMN IF NOT EXISTS geometry_json jsonb;
--   UPDATE properties
--   SET geometry_json = (COALESCE(geometry_json::jsonb, ST_AsGeoJSON(geometry)::jsonb))::json
--   WHERE geometry IS NOT NULL;

--   ALTER TABLE properties ADD COLUMN IF NOT EXISTS x1 integer;
--   ALTER TABLE properties ADD COLUMN IF NOT EXISTS x2 integer;
--   ALTER TABLE properties ADD COLUMN IF NOT EXISTS z1 integer;
--   ALTER TABLE properties ADD COLUMN IF NOT EXISTS z2 integer;

--   UPDATE properties
--   SET
--     x1 = round(ST_XMin(geometry) * 100)::integer,
--     x2 = round(ST_XMax(geometry) * 100)::integer,
--     z1 = round(ST_YMin(geometry) * 100)::integer,
--     z2 = round(ST_YMax(geometry) * 100)::integer
--   WHERE geometry IS NOT NULL;

--   ALTER TABLE properties ADD COLUMN IF NOT EXISTS bounds cube;
--   UPDATE properties
--   SET bounds = cube(
--     ARRAY[x1::float8, y1::float8, z1::float8],
--     ARRAY[x2::float8, y2::float8, z2::float8]
--   )
--   WHERE x1 IS NOT NULL AND y1 IS NOT NULL AND y2 IS NOT NULL;

--   ALTER TABLE islands ADD COLUMN IF NOT EXISTS geometry_json jsonb;
--   UPDATE islands
--   SET geometry_json = (COALESCE(geometry_json::jsonb, ST_AsGeoJSON(geometry)::jsonb))::json
--   WHERE geometry IS NOT NULL;

--   ALTER TABLE islands ADD COLUMN IF NOT EXISTS position_json jsonb;
--   UPDATE islands
--   SET position_json = (COALESCE(position_json::jsonb, ST_AsGeoJSON(ST_Centroid(geometry))::jsonb))::json
--   WHERE geometry IS NOT NULL;

--   ALTER TABLE suburbs ADD COLUMN IF NOT EXISTS position_json jsonb;
--   UPDATE suburbs
--   SET position_json = (COALESCE(position_json::jsonb, ST_AsGeoJSON("position")::jsonb))::json
--   WHERE "position" IS NOT NULL;

--   DROP TABLE IF EXISTS streets CASCADE;

--   DROP INDEX IF EXISTS idx_properties_geometry;

--   ALTER TABLE properties DROP COLUMN IF EXISTS geometry;
--   ALTER TABLE islands DROP COLUMN IF EXISTS geometry;
--   ALTER TABLE suburbs DROP COLUMN IF EXISTS "position";

--   DROP EXTENSION IF EXISTS postgis CASCADE;
-- $$
-- );


-- select apply_migration('drop-legacy-plpgsql-parcel-island-holes-hash',
-- $$
--   DO $d$
--   DECLARE r record;
--   BEGIN
--     FOR r IN
--       SELECT t.tgname
--       FROM pg_trigger t
--       JOIN pg_proc p ON p.oid = t.tgfoid
--       WHERE t.tgrelid = 'public.properties'::regclass
--         AND NOT t.tgisinternal
--         AND p.proname IN (
--           'recompute_island_holes_geometry_on_insert',
--           'recompute_island_holes_geometry_on_update',
--           'recompute_island_holes_geometry_on_truncate',
--           'update_properties_hash'
--         )
--     LOOP
--       EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.properties', r.tgname);
--     END LOOP;
--   END $d$;

--   DROP FUNCTION IF EXISTS public.recompute_island_holes_geometry_on_truncate();
--   DROP FUNCTION IF EXISTS public.recompute_island_holes_geometry_on_insert();
--   DROP FUNCTION IF EXISTS public.recompute_island_holes_geometry_on_update();
--   DROP FUNCTION IF EXISTS public.compute_island_holes_geometry_json(text);
--   DROP FUNCTION IF EXISTS public.add_inner_parcels_to_arch_island();
--   DROP FUNCTION IF EXISTS public.move_inner_features_to_inner_parcels();
--   DROP FUNCTION IF EXISTS public.update_properties_hash();
-- $$
-- );

-- Create traffic schema
DO $$
BEGIN
    -- 1. Create the 'traffic' schema if it doesn't exist
    CREATE SCHEMA IF NOT EXISTS metrics;

    -- 2. Loop to create the 14 rotation tables
    FOR i IN 1..7 LOOP
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS metrics.day_%s (
                client_id  BIGINT NOT NULL,
                action      "char" NOT NULL,
                parcel     INTEGER,
                position   CUBE NOT NUll,
                created_at TIMESTAMPTZ DEFAULT now() NOT NULL
            ) 
            WITH (
                autovacuum_enabled = false
            );
            
            -- BRIN index for high-speed time-series ingestion
            CREATE INDEX IF NOT EXISTS idx_day_%s_time 
            ON metrics.day_%s USING BRIN (created_at);
            
            -- B-Tree for specific parcel lookups
            CREATE INDEX IF NOT EXISTS idx_day_%s_parcel 
            ON metrics.day_%s (parcel);
        ', 
        LPAD(i::text, 2, '0'), 
        LPAD(i::text, 2, '0'), 
        LPAD(i::text, 2, '0'),
        LPAD(i::text, 2, '0'),
        LPAD(i::text, 2, '0'));
    END LOOP;
END $$;

