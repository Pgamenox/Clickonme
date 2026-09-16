# ClickOnMe

MVP autoservicio para crear, editar y publicar una tarjeta digital desde una cuenta de usuario.

## Flujo

1. La portada envía a `/crear/`.
2. El usuario se registra o inicia sesión con Supabase Auth.
3. Personaliza su tarjeta y elige una dirección única.
4. El perfil se publica en `/crear/perfil.html?u=su-direccion`.
5. Al volver al creador, su tarjeta se carga para continuar editándola.

La configuración pública de Supabase está en `supabase-config.js`. El esquema y las políticas RLS reproducibles están en `supabase/schema.sql`.
