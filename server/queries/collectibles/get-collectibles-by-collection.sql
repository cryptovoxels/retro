select 
  wearables.id,
  wearables.updated_at,
  wearables.name,
  token_id,
  category,
  wearables.description,
  issues,
  author,
  (select avatars.name from avatars where lower(avatars.owner) = lower(wearables.author)) as author_name,
  hash
from 
  wearables 
where
  collection_id = $1
limit 
  256;
