# ClickOnMe — Checklist de seguridad y recuperación

Estado verificado: 2026-09-21

## Ya protegido

- QA automático activo.
- Security Gate automático activo.
- Backup automático de código activo.
- Punto de restauración: `restore-point-2026-09-21`.
- Rama `main` protegida por ruleset activo `Protect ClickOnMe main`.
- Borrado de `main` bloqueado.
- Force push sobre `main` bloqueado.
- `.gitignore` bloquea secretos y llaves privadas comunes.
- `CODEOWNERS` define propietario de código.
- Política `SECURITY.md` creada.
- Scripts externos restringidos a hosts aprobados.
- RLS activo en tablas críticas revisadas.
- Código fuente de Edge Functions versionado en GitHub.
- ZIP físico de contingencia generado previamente.
- Lectura anónima de `profiles` restringida a las columnas necesarias para la tarjeta pública.
- `anon` ya no puede leer `user_id`, `created_by`, `sales_rep_code`, `id`, `created_at` ni `updated_at` de perfiles.
- `anon` ya no puede ejecutar `admin_suspend_profile`.
- `profile-analytics` endurecida en producción (v3): sesión UUID obligatoria, payload limitado y frenos anti-spam.
- Storage `profile-assets` revisado: escrituras limitadas por carpeta UUID del usuario.
- El secreto del cron de renovaciones fue retirado del comando programado y guardado cifrado en Supabase Vault.
- Cron `clickonme-renewal-reminders` activo; sus últimas ejecuciones revisadas terminaron correctamente.

## GitHub — pendiente para una etapa posterior

No activar todavía requisitos de Pull Request / status checks obligatorios mientras el flujo de trabajo siga haciendo cambios directos sobre `main`.

Cuando migremos a trabajo por ramas + Pull Request:
1. Exigir los checks `constructor-integrity` y `security-scan`.
2. Exigir Pull Request antes de fusionar a `main`.
3. Mantener solo colaboradores estrictamente necesarios.
4. Verificar 2FA de todas las cuentas con permiso de escritura.

## Supabase Auth — cambios intencionalmente aplazados

No modificar estos puntos sin adaptar y probar primero el frontend:

- CAPTCHA: sigue apagado porque el cliente actual todavía no envía `captchaToken`.
- Secure password change / requerir contraseña actual: no activar hasta adaptar el flujo `PASSWORD_RECOVERY`.
- MFA de la cuenta administrativa: el intento manual falló; no volver a forzarlo hasta resolver el método de autenticador con seguridad.
- Protección contra contraseñas filtradas: el asesor la marca desactivada y el Dashboard actual la muestra como función de plan superior.
- Redirect wildcard `https://clickonme.pro/crear/**`: mantener hasta probar confirmación de correo, Google OAuth y recuperación de contraseña con los redirects exactos ya añadidos.

Rate limit de sign-in/sign-up verificado en 20 solicitudes por 5 minutos por IP.

## Migración administrativa segura en curso

- Edge Function `admin-profile-actions` desplegada en producción con `verify_jwt=true`.
- Prueba sin sesión verificada: responde 401 antes de ejecutar código.
- RPC servidor `admin_profile_action_server` creada para `service_role` exclusivamente.
- `anon` y `authenticated` NO pueden ejecutar esa RPC.
- Self-test transaccional de autorizar/suspender/reactivar/eliminar pasó y terminó con `ROLLBACK`, sin cambios reales.
- La comprobación `health` fue confirmada desde una sesión administrativa real: `Canal administrativo seguro` mostró `Listo`.
- El panel Admin ya enruta autorizar plan, suspender y eliminar por `admin-profile-actions` cuando el canal seguro está disponible.
- Las RPC antiguas permanecen temporalmente como respaldo solo si el canal seguro no queda disponible al abrir el Admin.
- No revocar en bloque las RPC antiguas: `admin_suspend_profile` ya fue cerrada para usuarios autenticados; las tres restantes se retirarán después de confirmar una acción administrativa real por la Edge Function y mantener QA/Security en verde.

## Advertencia actual del asesor de Supabase

Supabase marca tres funciones `SECURITY DEFINER` todavía ejecutables por usuarios autenticados:

- `admin_authorize_plan`
- `admin_delete_profile`
- `admin_set_profile_suspension`

`admin_suspend_profile` fue verificada contra una copia completa del código: no tenía consumidores de aplicación, solo referencias de documentación. Su permiso para `authenticated` ya fue revocado; conserva acceso de backend mediante `service_role`.

Las tres advertencias restantes se mantienen temporalmente como respaldo mientras confirmamos la primera acción administrativa real por `admin-profile-actions`.

Siguiente endurecimiento recomendado:
- mover acciones administrativas a una Edge Function administrativa o a un esquema no expuesto,
- verificar JWT y rol de administrador en servidor,
- después revocar ejecución directa desde `authenticated`.

## Backups aún pendientes

El respaldo ZIP de código NO sustituye un backup completo de Supabase.

Todavía falta mantener periódicamente:

- dump real de la base de datos;
- copia física de los archivos de Storage;
- copia fuera de línea en USB/disco externo.

En plan Free, usar los scripts de `recovery/` con una conexión de base de datos válida. Los backups SQL de Supabase no incluyen el contenido físico de Storage.

El secreto `clickonme_reminder_cron_secret` vive en Vault y nunca debe copiarse al repositorio. Una restauración de base de datos debe conservar/restaurar Vault antes de habilitar el cron de recordatorios.

## Regla de recuperación

Nunca depender de una sola copia. Mantener:

- GitHub;
- rama/punto de restauración;
- backup automático;
- ZIP físico desconectado;
- backup de base de datos;
- copia de Storage.
