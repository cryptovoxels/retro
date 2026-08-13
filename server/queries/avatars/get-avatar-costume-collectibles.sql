with attchmnts as (select json_array_elements(c.attachments) as a
                   from avatars
                            left JOIN
                        costumes c
                        on
                            costume_id = c.id
                   where lower(avatars.owner) = lower($1)
                     and avatars.costume_id is not null
                     and c.attachments
    ::text <> 'null'
    )
   , wearables_info as (
-- an attachment carries only bone, position, rotation, scaling and wid, and wid is
-- wearables.id. the case guards the cast, since a costume is user written and wid is
-- only checked for being a string (see costumes.ts), so a malformed one would throw
SELECT
    w.token_id as wearable_id, w.collection_id as collection_id, w.issues as issues, w.name as name, (a->>'bone')::text as bone
FROM attchmnts
    left JOIN
    wearables w
on
    w.id = case when a->>'wid' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (a->>'wid')::uuid end
where w.token_id is not null
    )

select *,
       (select c.name from collections c where c.id = winfo.collection_id) as collection_name,
       (select c.chainid from collections c where c.id = winfo.collection_id) as chain_id,
       (select c.address from collections c where c.id = winfo.collection_id) as collection_address
from wearables_info winfo