SELECT parcel_events.*,
       properties.id AS parcel_id,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(parcel_events.author) LIMIT 1) sub),
         to_json(parcel_events.author)
       ) AS author
FROM parcel_events
         LEFT JOIN
     properties ON properties.id = parcel_events.parcel_id
WHERE parcel_events.parcel_id = $1
  AND parcel_events.expires_at < NOW()
ORDER BY parcel_events.expires_at DESC LIMIT 6;
