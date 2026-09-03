select properties.id as id,
       y2 - y1 as height,
       address,
       suburbs.name as suburb,
       properties.island,
       properties.name as name,
       (select jsonb_agg(
          coalesce((select to_jsonb(a) from (select id, name, owner, created_at from avatars where lower(owner) = lower(pu.wallet) limit 1) a), jsonb_build_object('owner', lower(pu.wallet)))
          || jsonb_build_object('role', pu.role)
        ) from parcel_users pu where pu.parcel_id = properties.id) as parcel_users,
       geometry_json as geometry,
       CAST(distance_to_center as double precision),
       CAST(distance_to_ocean as double precision),
       CAST(distance_to_closest_common as double precision),
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(properties.owner) LIMIT 1) sub),
         to_json(lower(properties.owner))
       ) as owner,
       memoized_hash as hash,
       properties.x1,
       properties.x2,
       y1,
       lightmap_url,
       label,
       y2,
       visible,
       properties.z1,
       properties.z2
from properties
         left join suburbs on properties.suburb_id = suburbs.id
where minted = true limit
  $1;
