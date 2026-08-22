select properties.id as id,
       y2 - y1 as height,
       address,
       properties.kind,
       suburbs.name as suburb,
       properties.island,
       properties.name as name,
       geometry_json as geometry,
       CAST(distance_to_center as double precision),
       CAST(distance_to_ocean as double precision),
       CAST(distance_to_closest_common as double precision),
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(properties.owner) LIMIT 1) sub),
         to_json(lower(properties.owner))
       ) as owner,
       properties.x1,
       properties.x2,
       y1,
       label,
       y2 - y1 as y2,
       properties.z1,
       properties.z2,
       memoized_hash as hash,
       properties.minted as minted,
       properties.space_id as space_id,
       properties.expires_at as expires_at
from properties
         left join suburbs on suburbs.id = properties.suburb_id
where (properties.id = $1 or address ILIKE '%'|| $1::text ||'%')
order by (CASE WHEN ($4::text = 'id' AND $5::boolean) THEN properties.id::varchar::int END) ASC,
         (CASE WHEN ($4::text = 'id' AND NOT $5::boolean) THEN properties.id::varchar::int END) DESC,
         (CASE WHEN ($4::text = 'name' AND $5::boolean) THEN properties.name::varchar END) ASC,
         (CASE WHEN ($4::text = 'name' AND NOT $5::boolean) THEN properties.name::varchar END) DESC,
         (CASE WHEN ($4::text = 'height' AND $5::boolean) THEN properties.y2::varchar::int END) ASC,
         (CASE WHEN ($4::text = 'height' AND NOT $5::boolean) THEN properties.y2::varchar::int END) DESC,
         (CASE WHEN ($4::text = 'island' AND $5::boolean) THEN properties.island::varchar END) ASC,
         (CASE WHEN ($4::text = 'island' AND NOT $5::boolean) THEN properties.island::varchar END) DESC,
         (CASE
              WHEN ($4::text = 'suburb' AND $5::boolean)
                  THEN (select name from suburbs where properties.suburb_id = suburbs.id)::varchar END) ASC,
         (CASE
              WHEN ($4::text = 'suburb' AND NOT $5::boolean)
                  THEN (select name from suburbs where properties.suburb_id = suburbs.id)::varchar END) DESC,
         (CASE WHEN ($4::text = 'distance' AND $5::boolean) THEN properties.distance_to_center END) ASC,
         (CASE WHEN ($4::text = 'distance' AND NOT $5::boolean) THEN properties.distance_to_center END) DESC limit
  $2
offset coalesce(($2::integer * $3::integer),0);
