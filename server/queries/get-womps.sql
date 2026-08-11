select womps.id,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(womps.author) LIMIT 1) sub),
         to_json(womps.author)
       ) as author,
       womps.content,
       womps.parcel_id,
       womps.image_url,
       womps.coords,
       womps.created_at,
       womps.updated_at,
       image IS NOT NULL as image_supplied,
       properties.name as parcel_name,
       properties.address as parcel_address,
       properties.island as parcel_island
from womps
         left join
     properties on womps.parcel_id = properties.id
where womps.kind = any($2)
order by id desc limit
  $1;
