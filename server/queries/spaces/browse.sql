select s.name,
       s.id,
       s.created_at,
       0 as x1,
       0 as y1,
       0 as z1,
       width as x2,
       height as y2,
       depth as z2,
       unlisted,
       visits,
       s."until",
       s."by",
       (s."until" is not null and s."until" > now()) as paid,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT a.id, a.name, a.owner, a.created_at FROM avatars a WHERE lower(a.owner) = lower(s.owner) LIMIT 1) sub),
         to_json(s.owner)
       ) as owner,
       json_array_length(null_if_invalid_string(s.content, s.id) -> 'features') as feature_count,
       count(*) OVER() AS pagination_count
from spaces s
where (
  case
    when $2::text = 'abandoned' then (s."until" is null or s."until" <= now())
    else (s."until" > now() and s.unlisted = false)
  end
)
order by coalesce(s.updated_at, '1900-01-01'::timestamp) desc limit
  100
offset coalesce($1 * 100, 0);
