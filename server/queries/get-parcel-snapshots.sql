SELECT id,
       is_snapshot,
       parcel_id,
       content,
       snapshot_name,
       name,
       updated_at,
       created_at,
       content_hash
from property_versions
where parcel_id = $1
  and (is_snapshot = true OR ($2::boolean is TRUE AND created_at > now() - interval '1 hour'))
order by created_at desc;
