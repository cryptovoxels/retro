#!/bin/bash
# Dumps every object key in our DO Spaces buckets into tools/bucket-keys/keys.sqlite
# so we can fuzzy-match missing assets locally instead of guessing urls.
#
# usage: tools/bucket-keys/dump.sh [bucket ...]     (default: all, every bucket listed in parallel)
# needs: brew install awscli; FULLBUCKET_ACCESS / FULLBUCKET_SECRET in .env
# a finished <bucket>.tsv is skipped on rerun, delete it to redump.
set -uo pipefail
cd "$(dirname "$0")"
DB=keys.sqlite

export AWS_ACCESS_KEY_ID="$(grep '^FULLBUCKET_ACCESS=' ../../.env | cut -d= -f2-)"
export AWS_SECRET_ACCESS_KEY="$(grep '^FULLBUCKET_SECRET=' ../../.env | cut -d= -f2-)"
export AWS_DEFAULT_REGION=us-east-1 AWS_PAGER=""

# bucket:region
ALL="cryptovoxels:sfo2 cryptovoxels-dev:sfo2 wearables:sfo2 media-crvox:sfo2 textures:sfo2 crvoxproxy:sfo2 crvoxproxy-test:sfo2 voxels-sounds:sfo2 crvox-backups:sfo2 crvox-static-html:sfo2 crvox-object-backup:sfo3 next-assets:sfo3 exporter-voxels:sfo3 voxels-zip:sfo3 texturetest:sfo3 beta-voxels:syd1 voxels-ugc:syd1"

dump() {
  local b=$1 region=$2
  # aws: Key<TAB>Size<TAB>LastModified ; awk adds bucket + lowercased basename
  aws s3api list-objects-v2 --bucket "$b" --endpoint-url "https://$region.digitaloceanspaces.com" \
    --query 'Contents[].[Key,Size,LastModified]' --output text \
    | awk -F'\t' -v b="$b" 'BEGIN{OFS="\t"} $1!="None" { n=$1; sub(/.*\//,"",n); print b, $1, tolower(n), $2, substr($3,1,10) }' \
    > "$b.tsv.part"
  if [ "${PIPESTATUS[0]}" = 0 ]; then
    mv "$b.tsv.part" "$b.tsv"
    echo "done  $b  $(wc -l < "$b.tsv") keys"
  else
    echo "FAIL  $b  (partial kept in $b.tsv.part)"
  fi
}

want=()
for pair in $ALL; do
  b=${pair%%:*}; region=${pair##*:}
  if [ $# -gt 0 ] && ! printf '%s\n' "$@" | grep -qx "$b"; then continue; fi
  want+=("$b")
  [ -f "$b.tsv" ] && continue
  dump "$b" "$region" &
done
wait

for b in "${want[@]}"; do
  [ -f "$b.tsv" ] || continue
  sqlite3 "$DB" <<SQL
create table if not exists keys (bucket text, key text, name text, size int, modified text);
delete from keys where bucket = '$b';
.mode tabs
.import $b.tsv keys
SQL
done

sqlite3 "$DB" "create index if not exists keys_name on keys(name); create index if not exists keys_bucket on keys(bucket);"
sqlite3 -column "$DB" "select bucket, count(*) keys, printf('%.1f gb', sum(size)/1e9) size from keys group by bucket order by 2 desc"
