select properties.id as id,
       y2 - y1 as height,
       address,
       properties.name as name,
       geometry_json as geometry,
       CAST(distance_to_center as double precision),
       CAST(distance_to_ocean as double precision),
       CAST(distance_to_closest_common as double precision),
       (select name from suburbs where properties.suburb_id = suburbs.id) as suburb,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(properties.owner) LIMIT 1) sub),
         to_json(lower(properties.owner))
       ) as owner,
       properties.x1,
       properties.x2,
       properties.y1,
       properties.y2,
       properties.z1,
       properties.z2
from properties
where sandbox = true
order by name nulls last, id;
