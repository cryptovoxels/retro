/* Get parcels for the map; the purpose of this is to have a smaller query */
select properties.id as id,
       address,
       properties.name as name,
       properties.description as description,
       properties.is_common as is_common,
       suburbs.name as suburb,
       (select jsonb_agg(
          coalesce((select to_jsonb(a) from (select id, name, owner, created_at from avatars where lower(owner) = lower(pu.wallet) limit 1) a), jsonb_build_object('owner', lower(pu.wallet)))
          || jsonb_build_object('role', pu.role)
        ) from parcel_users pu where pu.parcel_id = properties.id) as parcel_users,
       properties.settings,
       properties.sandbox,
       island,
       geometry_json as geometry,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(properties.owner) LIMIT 1) sub),
         to_json(lower(properties.owner))
       ) as owner,
       properties.x1,
       properties.x2,
       label,
       y2 - y1 as y2,
       properties.z1,
       properties.z2,
       (listed_at >= (NOW() - interval '4 days')) ::boolean as on_sale
from properties
         left join suburbs on properties.suburb_id = suburbs.id
where minted = true
order by ID asc;
