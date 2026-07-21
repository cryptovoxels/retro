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
       -- the engine builds/renders inside the world bounds; x1..z2 stay on-chain interior
       COALESCE(world_x1, properties.x1) as x1,
       COALESCE(world_x2, properties.x2) as x2,
       COALESCE(world_y1, y1) as y1,
       lightmap_url,
       is_common,
       COALESCE(world_y2, y2) as y2,
       COALESCE(world_z1, properties.z1) as z1,
       COALESCE(world_z2, properties.z2) as z2,
       settings
from properties
         left join
     suburbs on suburbs.id = properties.suburb_id
         left join
     (select parcel_id, 
             array_to_json(array_agg(json_build_object('wallet', wallet, 'role', role))) as parcel_users
      from parcel_users
      group by parcel_id) pu_agg on pu_agg.parcel_id = properties.id
where visible;
