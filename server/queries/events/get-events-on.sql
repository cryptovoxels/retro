SELECT parcel_events.*,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(parcel_events.author) LIMIT 1) sub),
         to_json(parcel_events.author)
       ) AS author,
       (SELECT name FROM suburbs WHERE properties.suburb_id = suburbs.id) AS parcel_suburb,
       properties.name AS parcel_name,
       properties.address AS parcel_address,
       properties.geometry_json AS geometry,
       properties.x1 AS x1,
       properties.x2 AS x2,
       properties.y1,
       properties.y2,
       properties.y2 AS height,
       properties.z1 AS z1,
       properties.z2 AS z2
FROM parcel_events
         LEFT JOIN
     properties ON parcel_events.parcel_id = properties.id
WHERE expires_at > NOW()
  AND ((NOT $1) OR starts_at < now())
ORDER BY starts_at ASC;
