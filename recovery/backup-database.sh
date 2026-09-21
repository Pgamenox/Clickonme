#!/usr/bin/env bash
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "Falta SUPABASE_DB_URL."
  echo "Define la conexión privada solo en esta terminal. No la guardes en Git."
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
OUT="clickonme-db-${STAMP}"
mkdir -p "$OUT"

supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT/roles.sql" --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT/schema.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$OUT/data.sql" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"

sha256sum "$OUT/"*.sql > "$OUT/SHA256SUMS.txt"

echo "Backup listo en $OUT"
echo "Cópialo a un disco externo y desconecta el disco al terminar."
