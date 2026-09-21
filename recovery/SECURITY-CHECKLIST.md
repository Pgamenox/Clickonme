# ClickOnMe — Checklist de seguridad pendiente

Estado verificado: 2026-09-21

## Ya protegido

- QA automático activo.
- Security Gate automático activo.
- Backup automático de código activo.
- Punto de restauración: `restore-point-2026-09-21`.
- `.gitignore` bloquea secretos y llaves privadas comunes.
- `CODEOWNERS` define propietario de código.
- Política `SECURITY.md` creada.
- Scripts externos restringidos a hosts aprobados.
- RLS activo en tablas críticas revisadas.
- Código fuente de Edge Functions versionado en GitHub.
- ZIP físico de contingencia generado.

## Falta hacer manualmente en GitHub

La rama `main` sigue sin protección administrativa.

Configurar en GitHub:
1. Settings → Rules → Rulesets / Branch protection.
2. Proteger la rama `main`.
3. Bloquear force push.
4. Bloquear borrado de rama.
5. Exigir checks exitosos antes de aceptar cambios.
6. Exigir:
   - ClickOnMe QA Gate
   - ClickOnMe Security Gate
7. Mantener solo colaboradores estrictamente necesarios.
8. Activar 2FA en la cuenta propietaria y cuentas con escritura.

## Falta hacer manualmente en Supabase

1. Auth → Password Security:
   - activar protección contra contraseñas filtradas.
2. Mantener 2FA en la cuenta de Supabase.
3. Confirmar plan de backups:
   - Pro/Team/Enterprise: revisar Database → Backups.
   - Free: ejecutar periódicamente `recovery/backup-database.ps1` o `.sh`.
4. Copiar Storage por separado del backup SQL.

## Advertencia actual del asesor de Supabase

Supabase marca tres funciones `SECURITY DEFINER` ejecutables por usuarios autenticados:

- `admin_authorize_plan`
- `admin_delete_profile`
- `admin_set_profile_suspension`

Actualmente las tres funciones verifican internamente que `auth.uid()` pertenezca a `admin_users`. Por eso NO se revocaron permisos automáticamente: hacerlo sin migrar el Admin rompería funciones administrativas.

Siguiente endurecimiento recomendado:
- mover estas acciones a una Edge Function administrativa o a un esquema no expuesto,
- verificar JWT y rol de administrador en servidor,
- después revocar ejecución directa desde `authenticated`.

## Regla de recuperación

Nunca depender de una sola copia. Mantener:

- GitHub
- rama/punto de restauración
- backup automático
- ZIP físico desconectado
- backup de base de datos
- copia de Storage
