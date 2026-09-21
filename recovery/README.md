# ClickOnMe — Plan de recuperación

Este directorio contiene instrucciones de contingencia. No contiene contraseñas, service-role keys ni tokens privados.

## Proyecto actual

- Supabase project ref: `jjiiuvfshzdgjalmsaay`
- Región: `us-west-2`
- Base de datos: PostgreSQL 17
- Bucket principal de archivos: `profile-assets`
- Rama de restauración de código creada: `restore-point-2026-09-21`

## Orden de recuperación recomendado

1. Restaurar el código desde GitHub o desde el ZIP físico.
2. Restaurar la base de datos desde un backup nativo de Supabase o desde `roles.sql`, `schema.sql` y `data.sql`.
3. Restaurar objetos de Supabase Storage por separado.
4. Volver a configurar secretos de Edge Functions y proveedores externos.
5. Verificar Auth/OAuth, Mercado Pago, Resend y dominios.
6. Ejecutar QA y Security Gate antes de volver a producción.

## Copia completa de la base de datos

Supabase recomienda crear tres archivos:

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f schema.sql
supabase db dump --db-url "$SUPABASE_DB_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

Nunca escribas la contraseña en un archivo del repositorio. Define `SUPABASE_DB_URL` solo en tu equipo local.

## Restauración de base de datos

En un proyecto Supabase nuevo:

```bash
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql --dbname "$NEW_SUPABASE_DB_URL"
```

## Storage

Los backups de base de datos NO contienen los archivos reales de Storage. Fotos, PDFs y audio deben copiarse por separado. Actualmente ClickOnMe utiliza el bucket público `profile-assets`.

## Edge Functions

El código fuente de las Edge Functions está versionado en `supabase/functions/`. Después de una restauración se deben volver a desplegar y reconfigurar sus secretos.

## Regla de oro

Mantener como mínimo:

- una copia en GitHub,
- una rama/punto de restauración,
- un ZIP físico fuera de línea,
- un backup de base de datos,
- una copia de Storage.

No dejar el único respaldo conectado permanentemente al mismo equipo.
