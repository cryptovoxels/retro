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
       image IS NOT NULL as image_supplied,
       spaces.name as parcel_name,
       'The void' as parcel_address
from womps
         left join
     spaces on womps.space_id = spaces.id
where womps.space_id = $1
  and womps.kind != 'report'
order by
    id desc
    limit
    $2;
