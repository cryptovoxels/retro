select p.id,
       y2 - y1 as height,
       p.token,
       p.name,
       p.traffic_visits,
       address,
       p.visible,
       p.geometry_json as geometry,
       CAST(distance_to_center as double precision),
       CAST(distance_to_closest_common as double precision),
       CAST(distance_to_ocean as double precision),

       p.x1,
       p.x2,
       y1,
       y2,
       p.z1,
       p.z2,

       suburbs.name as suburb,

       is_common,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(p.owner) LIMIT 1) sub),
         to_json(lower(p.owner))
       ) as owner,
       p.updated_at,
       (select array_to_json(array_agg(
          COALESCE(
            (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(pu.wallet) LIMIT 1) sub),
            to_json(lower(pu.wallet))
          )
        )) from parcel_users pu where pu.parcel_id = p.id) as parcel_users,
       label,
       p.description,
       lightmap_url,
       content,
       p.settings,
       p.island,
       p.kind as kind,
       p.minted as minted
from properties p
         left join suburbs on suburbs.id = p.suburb_id
where p.id = $1
  AND (p.minted = true OR p.visible or $2)
