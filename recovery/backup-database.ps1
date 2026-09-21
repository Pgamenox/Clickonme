$ErrorActionPreference = "Stop"

if (-not $env:SUPABASE_DB_URL) {
  Write-Host "Falta SUPABASE_DB_URL."
  Write-Host "Define la conexión privada solo en esta sesión. No la guardes en Git."
  exit 1
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHHmmssZ")
$out = "clickonme-db-$stamp"
New-Item -ItemType Directory -Force -Path $out | Out-Null

supabase db dump --db-url $env:SUPABASE_DB_URL -f "$out\roles.sql" --role-only
supabase db dump --db-url $env:SUPABASE_DB_URL -f "$out\schema.sql"
supabase db dump --db-url $env:SUPABASE_DB_URL -f "$out\data.sql" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"

Get-ChildItem "$out\*.sql" | ForEach-Object {
  $hash = Get-FileHash $_.FullName -Algorithm SHA256
  "$($hash.Hash)  $($_.Name)"
} | Set-Content "$out\SHA256SUMS.txt"

Write-Host "Backup listo en $out"
Write-Host "Cópialo a un disco externo y desconecta el disco al terminar."
