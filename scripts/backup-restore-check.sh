#!/usr/bin/env bash
# Real backup + restore drill (master prompt test 18). Dumps DATABASE_URL, restores it into a fresh
# scratch database on the same server, compares every table's row count and the applied migrations,
# then drops the scratch database. Never touches the source database beyond reading it.
#   DATABASE_URL=postgres://user:pass@host:5432/mvc bash scripts/backup-restore-check.sh [backup-dir]
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
dir="${1:-./backups}"
mkdir -p "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$dir/mvc-$stamp.dump"
scratch="mvc_restore_check_${stamp,,}"
base="${DATABASE_URL%/*}"

pg_dump --format=custom --no-owner --file="$file" "$DATABASE_URL"
echo "backup: $file ($(du -h "$file" | cut -f1))"

psql "$DATABASE_URL" -qAt -c "create database $scratch" >/dev/null
trap 'psql "$DATABASE_URL" -qAt -c "drop database if exists $scratch" >/dev/null' EXIT
pg_restore --no-owner --exit-on-error --dbname="$base/$scratch" "$file"

counts() {
  psql "$1" -qAt -F'|' <<'SQL'
select format('%s|%s', c.relname,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='r' and n.nspname='public' order by c.relname;
SQL
}
src="$(counts "$DATABASE_URL")"
dst="$(counts "$base/$scratch")"
if [[ "$src" != "$dst" ]]; then
  diff <(echo "$src") <(echo "$dst") || true
  echo "RESTORE CHECK FAILED: row counts differ" >&2
  exit 1
fi
migrations="$(psql "$base/$scratch" -qAt -c "select count(*) from schema_migrations")"
postgis="$(psql "$base/$scratch" -qAt -c "select postgis_lib_version()")"
echo "restore OK: $(echo "$src" | wc -l) tables identical, $migrations migrations, PostGIS $postgis"
