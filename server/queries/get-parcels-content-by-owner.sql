select p.id,
       p.name,
       address,

       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(p.owner) LIMIT 1) sub),
         to_json(lower(p.owner))
       ) as owner,

       (content ->>'features')::json as features, (content ->>'tileset') ::text as tileset

from properties p
where lower(p.owner) = lower($1)
group by p.id;