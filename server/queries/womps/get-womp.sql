select womps.id,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(womps.author) LIMIT 1) sub),
         to_json(womps.author)
       ) as author,
       womps.content,
       womps.parcel_id,
       womps.space_id,
       womps.image_url,
       womps.coords,
       womps.metadata,
       womps.created_at,
       womps.updated_at,
       properties.name as parcel_name,
       properties.address as parcel_address,
       properties.island as parcel_island,
       spaces.name as space_name
from womps
         left join
     properties on coalesce(womps.parcel_id, 0)::integer = properties.id
left join
  spaces
on womps.space_id::uuid = spaces.id
where
    womps.id = $1
    limit
    1;
