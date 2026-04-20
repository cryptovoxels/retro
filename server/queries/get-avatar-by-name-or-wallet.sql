select avatars.id,
       owner,
       name,
       description,
       social_link_1,
       social_link_2,
       names,
       moderator,
       settings,
       (avatars.created_at AT TIME ZONE 'Pacific/Auckland') as created_at,
       (avatars.last_online AT TIME ZONE 'Pacific/Auckland') as last_online,
       costume_id,
       home_id,
       ((select row_to_json(d) from (select * from costumes c where costume_id = c.id) d )) as costume
from
    avatars
where
    lower (avatars.owner) = lower ($1)
   OR lower (avatars.name) = lower ($1);