select properties.id as id,
       y2 - y1 as height,
       address,
       suburbs.name as suburb,
       properties.island,
       properties.name as name,
       properties.kind,

       -- Optimize: Use aggregated LEFT JOIN instead of correlated subquery for better performance
       COALESCE(pu_agg.parcel_users, '[]'::jsonb) as parcel_users,
       geometry_json as geometry,
       visible,
       CAST(distance_to_center as double precision),
       CAST(distance_to_ocean as double precision),
       CAST(distance_to_closest_common as double precision),
       lower(properties.owner) as owner,
       memoized_hash as hash,
       properties.x1,
       properties.x2,
       y1,
       lightmap_url,
       is_common,
       y2,
       properties.z1,
       properties.z2,
       settings,
       sandbox
from properties
         left join
     suburbs on suburbs.id = properties.suburb_id
         left join
     (select pu.parcel_id,
             jsonb_agg(
               coalesce((select to_jsonb(a) from (select id, name, owner, created_at from avatars where lower(owner) = lower(pu.wallet) limit 1) a), jsonb_build_object('owner', lower(pu.wallet)))
               || jsonb_build_object('role', pu.role)
             ) as parcel_users
      from parcel_users pu
      group by pu.parcel_id) pu_agg on pu_agg.parcel_id = properties.id
where visible;
