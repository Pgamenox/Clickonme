$ErrorActionPreference = "Stop"

if (-not $env:NEW_SUPABASE_DB_URL) {
  Write-Host "Falta NEW_SUPABASE_DB_URL."
  Write-Host "No guardes contraseñas dentro de este script."
  exit 1
}

if ($args.Count -lt 1) {
  Write-Host "Uso: .\restore-database.ps1 <carpeta-backup>"
  exit 1
}

$dir = $args[0]
$roles = Join-Path $dir "roles.sql"
$schema = Join-Path $dir "schema.sql"
$data = Join-Path $dir "data.sql"

foreach ($file in @($roles,$schema,$data)) {
  if (-not (Test-Path $file)) {
    throw "Falta archivo requerido: $file"
  }
}

Write-Host "ATENCIÓN: esto modificará la base de datos indicada en NEW_SUPABASE_DB_URL."
$confirm = Read-Host "Escribe RESTAURAR para continuar"
if ($confirm -ne "RESTAURAR") {
  Write-Host "Cancelado."
  exit 1
}

psql --single-transaction --variable ON_ERROR_STOP=1 --file $roles --file $schema --command "SET session_replication_role = replica" --file $data --dbname $env:NEW_SUPABASE_DB_URL

Write-Host "Restauración SQL terminada. Ahora verifica Storage, Edge Functions, Auth y secretos."
