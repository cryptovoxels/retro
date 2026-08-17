select properties.id as id,
       y2 - y1 as height,
       address,
       suburbs.name as suburb,
       properties.island,
       properties.name as name,
       properties.kind,

       -- Optimize: Use aggregated LEFT JOIN instead of correlated subquery for better performance
       COALESCE(pu_agg.parcel_users, '[]'::json) as parcel_users,
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
     (select parcel_id, 
             array_to_json(array_agg(json_build_object('wallet', wallet, 'role', role))) as parcel_users
      from parcel_users
      group by parcel_id) pu_agg on pu_agg.parcel_id = properties.id
where visible;
