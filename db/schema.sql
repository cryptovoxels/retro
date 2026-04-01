\restrict AMOmwf1LRjL6g9j1NDUfjD9bHTJXFowqEpJdNdzzeTYGcLlCTSaG4rHjuajSXi1
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';
CREATE EXTENSION IF NOT EXISTS cube WITH SCHEMA public;
COMMENT ON EXTENSION cube IS 'data type for multidimensional cubes';
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;
COMMENT ON EXTENSION pg_stat_statements IS 'track execution statistics of all SQL statements executed';
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';
CREATE TYPE public.avatar_type AS ENUM (
    'woody',
    'vidda',
    'bnolan',
    'external'
);
CREATE TYPE public.license_enum AS ENUM (
    'CC0',
    'CC_BY',
    'CC_BY_SA',
    'CC_BY_ND',
    'CC_BY_NC',
    'CC_BY_NC_SA',
    'CC_BY_NC_ND',
    'EXCLUSIVE',
    'free',
    'FREE'
);
CREATE FUNCTION public.apply_migration(migration_name text, ddl text) RETURNS boolean
    LANGUAGE plpgsql
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
    $$;
CREATE FUNCTION public.get_or_create_user_uuid(_email text, OUT id uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
    BEGIN
    LOOP
       BEGIN  -- start inner block inside loop to handle possible exception
       SELECT INTO id users.id FROM users WHERE users.email = _email;
       IF NOT FOUND THEN
          INSERT INTO users (email, created_at) VALUES (_email, NOW()) RETURNING users.id INTO id;
       END IF;
       EXCEPTION WHEN UNIQUE_VIOLATION THEN     -- inserted in concurrent session.
          RAISE NOTICE 'It actually happened!'; -- hardly ever happens
       END;
       EXIT WHEN id IS NOT NULL;          -- else keep looping
    END LOOP;
    END
    $$;
CREATE FUNCTION public.null_if_invalid_string(json_input json, record_id uuid) RETURNS json
    LANGUAGE plpgsql
    AS $$
  DECLARE json_value JSON DEFAULT NULL;
  BEGIN
    BEGIN
      json_value := json_input ->> 'location';
      EXCEPTION WHEN OTHERS
      THEN
        RAISE NOTICE 'Invalid json value: "%".  Returning NULL.', record_id;
        RETURN NULL;
    END;
    RETURN json_input;
  END;
  $$;
CREATE FUNCTION public.recalculate_total_wearables() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  BEGIN
      -- Recalculate the total wearables for the affected collection
      UPDATE collections
      SET total_wearables = (
          SELECT count(id)
          FROM wearables
          WHERE token_id is not null
            AND collection_id = NEW.collection_id
      )
      WHERE id = NEW.collection_id;
      
      RETURN NULL;
  END;
  $$;
CREATE TEXT SEARCH DICTIONARY public.simple_english (
    TEMPLATE = pg_catalog.simple,
    stopwords = 'english' );
CREATE TEXT SEARCH CONFIGURATION public.simple_english (
    PARSER = pg_catalog."default" );
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR asciiword WITH public.simple_english;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR word WITH public.simple_english;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR numword WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR email WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR url WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR host WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR sfloat WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR version WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR hword_numpart WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR hword_part WITH public.simple_english;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR hword_asciipart WITH public.simple_english;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR numhword WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR asciihword WITH public.simple_english;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR hword WITH public.simple_english;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR url_path WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR file WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR "float" WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR "int" WITH simple;
ALTER TEXT SEARCH CONFIGURATION public.simple_english
    ADD MAPPING FOR uint WITH simple;
CREATE TABLE public.applied_migrations (
    identifier text NOT NULL,
    ddl text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.asset_library (
    id uuid NOT NULL,
    type text DEFAULT 'feature'::text NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(200),
    category character varying(50) DEFAULT 'miscellaneous'::character varying NOT NULL,
    author text NOT NULL,
    content json NOT NULL,
    hash text,
    public boolean DEFAULT true NOT NULL,
    image_url text,
    views integer DEFAULT 0,
    has_script boolean DEFAULT false,
    has_unsafe_script boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
CREATE TABLE public.avatars (
    id integer NOT NULL,
    owner text,
    name text,
    settings json,
    skin text,
    names text[],
    moderator boolean DEFAULT false,
    description text,
    social_link_1 text,
    social_link_2 text,
    costume_id integer,
    created_at timestamp without time zone DEFAULT now(),
    last_online timestamp without time zone DEFAULT now(),
    type public.avatar_type DEFAULT 'woody'::public.avatar_type NOT NULL
);
CREATE SEQUENCE public.avatars_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.avatars_id_seq OWNED BY public.avatars.id;
CREATE TABLE public.banned_users (
    id integer NOT NULL,
    wallet text NOT NULL,
    reason text,
    expires_at timestamp without time zone DEFAULT (now() + '7 days'::interval),
    can_chat boolean DEFAULT false,
    can_build boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.blocked_users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.blocked_users_id_seq OWNED BY public.banned_users.id;
CREATE TABLE public.collections (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    logo bytea,
    owner text NOT NULL,
    address text,
    slug text,
    type text DEFAULT 'ERC1155'::text,
    chainid integer DEFAULT 1,
    suppressed boolean DEFAULT false,
    rejected_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    settings json,
    collectibles_type text DEFAULT 'wearables'::text,
    discontinued boolean DEFAULT false,
    custom_attributes_names json[],
    image_url text,
    license public.license_enum DEFAULT 'CC0'::public.license_enum NOT NULL,
    total_wearables integer
);
CREATE SEQUENCE public.collections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.collections_id_seq OWNED BY public.collections.id;
CREATE TABLE public.comments (
    id integer NOT NULL,
    body text,
    commentable_type text,
    commentable_id text,
    created_at timestamp without time zone DEFAULT now(),
    owner text
);
CREATE SEQUENCE public.comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.comments_id_seq OWNED BY public.comments.id;
CREATE TABLE public.costumes (
    id integer NOT NULL,
    wallet text,
    attachments json DEFAULT '[]'::json NOT NULL,
    skin text,
    name text,
    default_color text DEFAULT '#f3f3f3'::text NOT NULL,
    CONSTRAINT attachments_is_a_json_array CHECK ((json_typeof(attachments) = 'array'::text))
);
CREATE SEQUENCE public.costumes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.costumes_id_seq OWNED BY public.costumes.id;
CREATE TABLE public.delegations (
    user_id uuid NOT NULL,
    wallet public.citext NOT NULL,
    created_at timestamp without time zone,
    effective_at date,
    expires_at date,
    signature text
);
CREATE TABLE public.emoji_badges (
    id integer NOT NULL,
    emojiable_id text,
    emojiable_type text,
    author text,
    emoji text,
    created_at timestamp without time zone DEFAULT now(),
    expires_at timestamp without time zone DEFAULT (now() + '3 mons'::interval)
);
CREATE SEQUENCE public.emoji_badges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.emoji_badges_id_seq OWNED BY public.emoji_badges.id;
CREATE TABLE public.favorites (
    id integer NOT NULL,
    wallet public.citext NOT NULL,
    token_id numeric(255,0) NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    metadata json,
    contract_address public.citext,
    coords public.citext
);
CREATE SEQUENCE public.favorites_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.favorites_id_seq OWNED BY public.favorites.id;
CREATE TABLE public.islands (
    id integer NOT NULL,
    name text,
    texture text DEFAULT '/textures/ground.png'::text,
    holes_geometry_json json NOT NULL,
    other_name character varying(50) DEFAULT NULL::character varying,
    lakes_geometry_json json NOT NULL,
    content jsonb,
    geometry_json jsonb,
    position_json jsonb
);
CREATE SEQUENCE public.islands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.islands_id_seq OWNED BY public.islands.id;
CREATE TABLE public.jobs (
    id integer NOT NULL,
    parcel_id integer,
    type text,
    params json,
    created_at timestamp without time zone DEFAULT now(),
    processed_at timestamp without time zone,
    acquired_at timestamp without time zone,
    acquired_info json,
    processed_info json
);
CREATE SEQUENCE public.jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.jobs_id_seq OWNED BY public.jobs.id;
CREATE TABLE public.mails (
    id integer NOT NULL,
    sender text NOT NULL,
    destinator text NOT NULL,
    subject text NOT NULL,
    content text NOT NULL,
    read boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.mailboxes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.mailboxes_id_seq OWNED BY public.mails.id;
CREATE TABLE public.metrics (
    id integer NOT NULL,
    name text NOT NULL,
    value double precision DEFAULT 1,
    label text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.metrics_id_seq OWNED BY public.metrics.id;
CREATE MATERIALIZED VIEW public.mv_costume_counts AS
 SELECT lower(wallet) AS lower_wallet,
    count(id) AS costume_count
   FROM public.costumes
  GROUP BY (lower(wallet))
  WITH NO DATA;
CREATE TABLE public.properties (
    id integer NOT NULL,
    owner text DEFAULT '0xa253D7cd38dC2D0B2E65AD42a7e4bEB3C60A83aD'::text NOT NULL,
    address text NOT NULL,
    visible boolean DEFAULT false,
    token integer,
    content json,
    minted boolean DEFAULT false,
    name text,
    minted_at timestamp without time zone,
    updated_at timestamp without time zone,
    rating double precision DEFAULT 0,
    description text,
    kind text,
    y1 integer,
    y2 integer,
    island text,
    bake boolean DEFAULT false,
    state json,
    hash text,
    memoized_hash text,
    label text,
    traffic_visits integer DEFAULT 0 NOT NULL,
    suburb_id integer,
    geometry_json json NOT NULL,
    is_common boolean DEFAULT false,
    listed_at timestamp without time zone,
    settings json DEFAULT '{}'::json NOT NULL,
    distance_to_center numeric DEFAULT 0 NOT NULL,
    distance_to_ocean numeric DEFAULT 0 NOT NULL,
    distance_to_closest_common numeric DEFAULT 0 NOT NULL,
    lightmap_url text,
    x1 integer,
    x2 integer,
    z1 integer,
    z2 integer,
    bounds public.cube
);
CREATE MATERIALIZED VIEW public.mv_property_counts AS
 SELECT lower(owner) AS lower_owner,
    count(id) AS parcel_count
   FROM public.properties
  WHERE ((minted = true) AND (island <> 'Test Island'::text))
  GROUP BY (lower(owner))
  WITH NO DATA;
CREATE TABLE public.spaces (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    name text,
    parcel_id integer,
    owner text,
    content json,
    width integer,
    height integer,
    depth integer,
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    description text,
    slug text,
    settings json DEFAULT '{}'::json NOT NULL,
    unlisted boolean DEFAULT false,
    visits integer DEFAULT 0,
    memoized_hash text,
    state json,
    lightmap_url text
);
CREATE MATERIALIZED VIEW public.mv_space_counts AS
 SELECT lower(owner) AS lower_owner,
    count(id) AS space_count
   FROM public.spaces
  GROUP BY (lower(owner))
  WITH NO DATA;
CREATE TABLE public.parcel_events (
    id integer NOT NULL,
    parcel_id integer,
    author text NOT NULL,
    name text NOT NULL,
    description text,
    color text DEFAULT 'mintcream'::text,
    timezone text,
    created_at timestamp without time zone DEFAULT now(),
    starts_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '01:00:00'::interval),
    category character varying(255)
);
CREATE SEQUENCE public.parcel_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.parcel_events_id_seq OWNED BY public.parcel_events.id;
CREATE TABLE public.parcel_users (
    parcel_id integer NOT NULL,
    wallet text NOT NULL,
    role text DEFAULT 'contributor'::text NOT NULL
);
CREATE SEQUENCE public.properties_id_seq
    START WITH 3027
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.properties_id_seq OWNED BY public.properties.id;
CREATE TABLE public.property_versions (
    id integer NOT NULL,
    parcel_id integer,
    content json,
    name text,
    updated_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    is_snapshot boolean DEFAULT false NOT NULL,
    snapshot_name text,
    content_hash bytea,
    ipfs_hash text
);
CREATE SEQUENCE public.property_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.property_versions_id_seq OWNED BY public.property_versions.id;
CREATE TABLE public.reports (
    id integer NOT NULL,
    reason text NOT NULL,
    extra text,
    author text NOT NULL,
    type text NOT NULL,
    reported_id text NOT NULL,
    resolved boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE public.reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.reports_id_seq OWNED BY public.reports.id;
CREATE TABLE public.wearables (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    name text,
    description text,
    author text,
    issues integer,
    token_id integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    data bytea,
    hash text,
    rejected_at timestamp without time zone,
    offer_prices numeric(20,10)[],
    collection_id integer NOT NULL,
    custom_attributes json[],
    suppressed boolean DEFAULT false,
    category text DEFAULT 'accessory'::text,
    default_settings json
);
CREATE MATERIALIZED VIEW public.search_corpus AS
 WITH src AS (
         SELECT (p.id)::text AS id,
            COALESCE(p.name, p.address) AS title,
            (p.id)::text AS description,
            p.minted_at AS created_at,
            'parcel'::text AS kind
           FROM public.properties p
          WHERE (p.minted OR p.is_common)
        UNION ALL
         SELECT (w.id)::text AS id,
            w.name,
            w.description,
            w.created_at,
            'wearable'::text
           FROM public.wearables w
        UNION ALL
         SELECT av.owner AS id,
            COALESCE(av.name, av.owner) AS "coalesce",
                CASE
                    WHEN (av.name IS NOT NULL) THEN av.owner
                    ELSE NULL::text
                END AS "case",
            av.created_at,
            'avatar'::text
           FROM public.avatars av
        UNION ALL
         SELECT (s.id)::text AS id,
            s.name,
            NULL::text,
            s.created_at,
            'space'::text
           FROM public.spaces s
          WHERE (s.unlisted IS DISTINCT FROM true)
        UNION ALL
         SELECT (al.id)::text AS id,
            al.name,
            al.description,
            al.created_at,
            'asset'::text
           FROM public.asset_library al
        )
 SELECT id,
    title,
    description,
    created_at,
    kind,
    (setweight(to_tsvector('english'::regconfig, title), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'B'::"char")) AS search_tsv
   FROM src
  WITH NO DATA;
CREATE TABLE public.suburbs (
    id integer NOT NULL,
    name text,
    position_json jsonb
);
CREATE SEQUENCE public.suburbs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.suburbs_id_seq OWNED BY public.suburbs.id;
CREATE TABLE public.traffic (
    id integer NOT NULL,
    visits integer,
    day integer,
    parcel_id integer
);
CREATE SEQUENCE public.traffic_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.traffic_id_seq OWNED BY public.traffic.id;
CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4(),
    email text,
    created_at timestamp without time zone
);
CREATE TABLE public.womps (
    id integer NOT NULL,
    author text,
    content text,
    parcel_id integer,
    coords text,
    meta json,
    image bytea,
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    kind text DEFAULT 'public'::text,
    image_url text NOT NULL,
    space_id uuid,
    depth_url text,
    metadata json
);
CREATE SEQUENCE public.womps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.womps_id_seq OWNED BY public.womps.id;
ALTER TABLE ONLY public.avatars ALTER COLUMN id SET DEFAULT nextval('public.avatars_id_seq'::regclass);
ALTER TABLE ONLY public.banned_users ALTER COLUMN id SET DEFAULT nextval('public.blocked_users_id_seq'::regclass);
ALTER TABLE ONLY public.collections ALTER COLUMN id SET DEFAULT nextval('public.collections_id_seq'::regclass);
ALTER TABLE ONLY public.comments ALTER COLUMN id SET DEFAULT nextval('public.comments_id_seq'::regclass);
ALTER TABLE ONLY public.costumes ALTER COLUMN id SET DEFAULT nextval('public.costumes_id_seq'::regclass);
ALTER TABLE ONLY public.emoji_badges ALTER COLUMN id SET DEFAULT nextval('public.emoji_badges_id_seq'::regclass);
ALTER TABLE ONLY public.favorites ALTER COLUMN id SET DEFAULT nextval('public.favorites_id_seq'::regclass);
ALTER TABLE ONLY public.islands ALTER COLUMN id SET DEFAULT nextval('public.islands_id_seq'::regclass);
ALTER TABLE ONLY public.jobs ALTER COLUMN id SET DEFAULT nextval('public.jobs_id_seq'::regclass);
ALTER TABLE ONLY public.mails ALTER COLUMN id SET DEFAULT nextval('public.mailboxes_id_seq'::regclass);
ALTER TABLE ONLY public.metrics ALTER COLUMN id SET DEFAULT nextval('public.metrics_id_seq'::regclass);
ALTER TABLE ONLY public.parcel_events ALTER COLUMN id SET DEFAULT nextval('public.parcel_events_id_seq'::regclass);
ALTER TABLE ONLY public.properties ALTER COLUMN id SET DEFAULT nextval('public.properties_id_seq'::regclass);
ALTER TABLE ONLY public.property_versions ALTER COLUMN id SET DEFAULT nextval('public.property_versions_id_seq'::regclass);
ALTER TABLE ONLY public.reports ALTER COLUMN id SET DEFAULT nextval('public.reports_id_seq'::regclass);
ALTER TABLE ONLY public.suburbs ALTER COLUMN id SET DEFAULT nextval('public.suburbs_id_seq'::regclass);
ALTER TABLE ONLY public.traffic ALTER COLUMN id SET DEFAULT nextval('public.traffic_id_seq'::regclass);
ALTER TABLE ONLY public.womps ALTER COLUMN id SET DEFAULT nextval('public.womps_id_seq'::regclass);
ALTER TABLE ONLY public.applied_migrations
    ADD CONSTRAINT applied_migrations_pkey PRIMARY KEY (identifier);
ALTER TABLE ONLY public.asset_library
    ADD CONSTRAINT asset_library_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.avatars
    ADD CONSTRAINT avatars_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.banned_users
    ADD CONSTRAINT blocked_users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.costumes
    ADD CONSTRAINT costumes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.delegations
    ADD CONSTRAINT delegations_user_id_wallet_key UNIQUE (user_id, wallet);
ALTER TABLE ONLY public.emoji_badges
    ADD CONSTRAINT emoji_badges_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.islands
    ADD CONSTRAINT islands_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mails
    ADD CONSTRAINT mailboxes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.metrics
    ADD CONSTRAINT metrics_name_label_key UNIQUE (name, label);
ALTER TABLE ONLY public.metrics
    ADD CONSTRAINT metrics_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.parcel_events
    ADD CONSTRAINT parcel_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.parcel_users
    ADD CONSTRAINT parcel_wallet_constraint UNIQUE (parcel_id, wallet);
ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.property_versions
    ADD CONSTRAINT property_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.suburbs
    ADD CONSTRAINT suburbs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.traffic
    ADD CONSTRAINT traffic_day_parcel_id_key UNIQUE (day, parcel_id);
ALTER TABLE ONLY public.traffic
    ADD CONSTRAINT traffic_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.avatars
    ADD CONSTRAINT unique_avatar_name UNIQUE (name);
ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT uniquefavorite UNIQUE (wallet, token_id);
ALTER TABLE ONLY public.wearables
    ADD CONSTRAINT wearables_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.womps
    ADD CONSTRAINT womps_pkey PRIMARY KEY (id);
CREATE INDEX asset_library_author_index ON public.asset_library USING btree (lower(author));
CREATE UNIQUE INDEX asset_library_hash_index ON public.asset_library USING btree (hash);
CREATE UNIQUE INDEX avatar_owner ON public.avatars USING btree (owner);
CREATE INDEX banned_users_lower_wallet_expires_at ON public.banned_users USING btree (lower(wallet), expires_at);
CREATE INDEX collectible_id_and_collection_id ON public.wearables USING btree (token_id, collection_id);
CREATE INDEX content_hash_index ON public.property_versions USING btree (content_hash);
CREATE INDEX destinator_index_mails ON public.mails USING btree (lower(destinator));
CREATE INDEX emoji_badges_index ON public.emoji_badges USING btree (emojiable_id, emojiable_type);
CREATE INDEX emoji_badges_index_with_author ON public.emoji_badges USING btree (emojiable_id, emojiable_type, lower(author));
CREATE INDEX events_index_parcel_id ON public.parcel_events USING btree (parcel_id);
CREATE INDEX idx_avatars_lower_owner ON public.avatars USING btree (lower(owner));
CREATE INDEX idx_avatars_name ON public.avatars USING btree (name);
CREATE INDEX idx_avatars_owner_last_online ON public.avatars USING btree (lower(owner), last_online);
CREATE INDEX idx_avatars_owner_lower ON public.avatars USING btree (lower(owner));
CREATE INDEX idx_costumes_wallet ON public.costumes USING btree (lower(wallet));
CREATE INDEX idx_costumes_wallet_lower ON public.costumes USING btree (lower(wallet));
CREATE INDEX idx_mv_costume_counts_lower_wallet ON public.mv_costume_counts USING btree (lower_wallet);
CREATE INDEX idx_mv_property_counts_lower_owner ON public.mv_property_counts USING btree (lower_owner);
CREATE INDEX idx_mv_space_counts_lower_owner ON public.mv_space_counts USING btree (lower_owner);
CREATE INDEX idx_properties_owner_island ON public.properties USING btree (lower(owner), island);
CREATE INDEX idx_properties_owner_lower ON public.properties USING btree (lower(owner));
CREATE INDEX idx_spaces_owner ON public.spaces USING btree (lower(owner));
CREATE INDEX idx_spaces_owner_lower ON public.spaces USING btree (lower(owner));
CREATE INDEX lower_avatar_name ON public.avatars USING btree (lower(name));
CREATE INDEX lower_avatar_owner ON public.avatars USING btree (lower(owner));
CREATE INDEX owner_index ON public.properties USING btree (lower(owner));
CREATE INDEX parcel_id_index ON public.property_versions USING btree (parcel_id);
CREATE INDEX properties_lower_name ON public.properties USING btree (lower(name));
CREATE INDEX properties_minted_idx1 ON public.properties USING btree (minted);
CREATE UNIQUE INDEX report_id_index ON public.reports USING btree (id);
CREATE INDEX sender_index_mails ON public.mails USING btree (lower(sender));
CREATE INDEX suburbs_id_name ON public.suburbs USING btree (id, name);
CREATE UNIQUE INDEX unique_token_wallet ON public.favorites USING btree (wallet, token_id, contract_address);
CREATE UNIQUE INDEX user_rights_idx ON public.parcel_users USING btree (parcel_id, lower(wallet));
CREATE UNIQUE INDEX wallet_parcel_id_idx ON public.favorites USING btree (wallet, token_id);
CREATE INDEX womps_author ON public.womps USING btree (lower(author));
CREATE UNIQUE INDEX womps_id ON public.womps USING btree (id);
CREATE INDEX womps_parcel_id ON public.womps USING btree (parcel_id);
CREATE TRIGGER wearables_recalculate_total_wearables_trigger AFTER INSERT ON public.wearables FOR EACH ROW WHEN ((new.token_id IS NOT NULL)) EXECUTE FUNCTION public.recalculate_total_wearables();
ALTER TABLE ONLY public.properties
    ADD CONSTRAINT suburb_cascading_foreign_key FOREIGN KEY (suburb_id) REFERENCES public.suburbs(id) ON DELETE CASCADE;
\unrestrict AMOmwf1LRjL6g9j1NDUfjD9bHTJXFowqEpJdNdzzeTYGcLlCTSaG4rHjuajSXi1
