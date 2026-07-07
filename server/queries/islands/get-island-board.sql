-- island notice board: one live note per wallet (see island-board.ts). notes expire after
-- 30 days so everything on the board is recent by construction. $3 is the viewer's wallet
-- (lowercased, '' when anonymous) for the per-user hearted flag.
select p.id,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner FROM avatars a WHERE lower(a.owner) = lower(p.author) LIMIT 1) sub),
         to_json(p.author)
       ) as author,
       p.content,
       p.created_at,
       p.parcel_id,
       (select coalesce(nullif(pr.name, ''), pr.address) from properties pr where pr.id = p.parcel_id) as parcel_name,
       (select count(*)::int from island_post_hearts h where h.post_id = p.id) as hearts,
       exists(select 1 from island_post_hearts h where h.post_id = p.id and h.wallet = $3::text) as hearted
from island_posts p
where p.island = $1::text
  and p.created_at > now() - interval '30 days'
order by p.created_at desc
limit $2;
