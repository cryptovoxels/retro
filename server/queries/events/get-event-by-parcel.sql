SELECT parcel_events.*,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(parcel_events.author) LIMIT 1) sub),
         to_json(parcel_events.author)
       ) AS author
FROM parcel_events
WHERE parcel_events.parcel_id = $1
ORDER BY parcel_events.id DESC LIMIT 1;
