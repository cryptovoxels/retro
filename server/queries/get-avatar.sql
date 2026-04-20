select avatars.id,
       owner,
       avatars.name,
       avatars.type,
       description,
       social_link_1,
       social_link_2,
       names,
       moderator,
       settings,
       -- naive timestamp: interpret wall clock as Pacific/Auckland (prod DB) so JSON dates are correct UTC
       (avatars.created_at AT TIME ZONE 'Pacific/Auckland') as created_at,
       (avatars.last_online AT TIME ZONE 'Pacific/Auckland') as last_online,
       costume_id,
       home_id,
       row_to_json(costumes.*) as costume
from
    avatars
    left join costumes
on costumes.id = avatars.costume_id
where
    lower (avatars.owner) = lower ($1);