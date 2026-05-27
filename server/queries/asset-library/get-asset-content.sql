select id,
       hash,
       name,
       type,
       content
from asset_library a
where id = $1
  and (public = true OR ($2::text IS NOT NULL and (lower ($2) = lower (a.author))))