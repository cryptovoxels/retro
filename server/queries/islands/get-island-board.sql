select p.id,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner FROM avatars a WHERE lower(a.owner) = lower(p.author) LIMIT 1) sub),
         to_json(p.author)
       ) as author,
       p.content,
       p.created_at
from island_posts p
where p.island = $1::text
order by p.id desc
limit $2;
