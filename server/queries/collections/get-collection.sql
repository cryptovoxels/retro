select 
  c.id,
  c.name,
  c.description,
  c.image_url,
  c.owner,
  address,
  slug,
  c.type,
  chainid,
  c.settings,
  suppressed,
  discontinued,
  collectibles_type,
  custom_attributes_names,
  rejected_at,
  c.created_at,
  (select count(w.id) from wearables w where w.collection_id = c.id and w.token_id is not null) as total,
  (select count(distinct w.author) from wearables w where w.collection_id = c.id and w.token_id is not null) as authors
from 
  collections c
where 
  c.id = $1
limit
  1;