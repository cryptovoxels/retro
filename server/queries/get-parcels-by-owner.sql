select properties.id,
       y2 - y1 as height,
       address,
       name,
       kind,
       geometry_json as geometry,
       CAST(distance_to_center as double precision),
       CAST(distance_to_closest_common as double precision),
       CAST(distance_to_ocean as double precision),

       properties.x1,
       properties.x2,
       y1,
       y2 - y1 as y2,
       properties.z1,
       properties.z2,

       (select name from suburbs where properties.suburb_id = suburbs.id) as suburb,
       properties.island,

       (select jsonb_agg(
          coalesce((select to_jsonb(a) from (select id, name, owner, created_at from avatars where lower(owner) = lower(pu.wallet) limit 1) a), jsonb_build_object('owner', lower(pu.wallet)))
          || jsonb_build_object('role', pu.role)
        ) from parcel_users pu where pu.parcel_id = properties.id) as parcel_users,
       label,
       description,
       bake,
       json_build_object('features', (content ->>'features')::json) as content,
       lower(owner) as owner
from properties
where lower(owner) = lower($1)
  AND minted = true
  and is_common <> true
order by ID asc;