# Reembolsos asistidos y precios por plan

Base: e0b8eccb4c1b620f6ee283def9be7bb256ca5abf. Se conserva Pgamenox/Clickonme y Supabase jjiiuvfshzdgjalmsaay.

## Precio Creator y antiguo cobro de $399

Revisados los valores activos: Free 0, Personal 600, Business 700, Artista 850, Creator 999 MXN anuales; ninguna promoción activa. La función desplegada create-mercadopago-order v19 consulta esos valores y envía unit_price correspondiente a Mercado Pago. El editor envía plan y expectedAmount. Una cotización Creator por 399 es rechazada antes de crear orden. Las pruebas existentes verifican los cuatro importes enviados al proveedor; nueva regresión comprueba explícitamente Creator/399 rechazado.

No se encontró enlace fijo mpago.la/Mercado Pago por $399 en HTML/JS actuales ni en el texto principal del documento maestro. Su historial sí describe el antiguo precio Personal 399, ahora sustituido. Dos órdenes históricas de producción de $399 siguen en created, sin provider_payment_id; no se cancelaron ni marcaron cobradas. El usuario no conserva el enlace externo original. No se puede asegurar que ese enlace esté desactivado en Mercado Pago; las nuevas compras del sitio no lo utilizan según el código revisado. No se realizó pago real.

## Implementado

- Migración aditiva supabase/assisted-refunds.sql, posterior a assisted-sales.sql.
- Cada nueva venta captura plan/estado/vigencia/prueba anteriores y secuencia de venta.
- Registro de devolución TOTAL ya efectuada, folio único, motivo, fecha y administrador. Nunca envía dinero.
- Reintento de la misma devolución no repite efectos; datos distintos son rechazados.
- Si corresponde exactamente al último derecho de acceso registrado, restaura el estado anterior; vigencia anterior vencida regresa a Free según regla existente.
- Compra posterior, estado modificado, historial insuficiente o devolución previa con revisión: conserva acceso actual y marca revisión de vigencia necesaria. No resuelve automáticamente esos casos.
- Comisión pendiente se cancela; comisión pagada pasa a por recuperar. Recuperación efectiva se registra con su folio, sin transferir dinero.
- No permite pagar comisiones de ventas devueltas. Cobros devueltos se excluyen de ingresos netos y conteo de ventas pagadas.
- Reporte/CSV conserva cobro original, devolución y recuperación. Corrección comercial por devolución completa + nuevo cobro auténtico; no borrar recibos.
- Un guardado exitoso sigue confirmado aunque falle la recarga posterior del panel.

## Pruebas

42 pruebas Node aprobadas; 56 pruebas SQL con rollback (15 pasarela, 6 manuales, 19 ventas asistidas y 16 devoluciones). Controles locales QA y seguridad aprobados. Incluye comisión pagada/recuperada, devolución repetida, renovación, compra posterior y rechazo de clientes no admin. No se crearon movimientos comerciales persistentes.

## Límites y siguientes acciones

No soporta devolución parcial ni transferencia automática. Casos de revisión de vigencia requieren conciliación humana; no usar cortesía repetida para ajustar un caso sin calcular la vigencia correcta. No se reconstruyen snapshots de ventas anteriores. No se vuelve a generar primera comisión después de devolver el primer pago.

Pendientes: probar panel desplegado; primera alta externa/venta real; conciliar las órdenes históricas con proveedor; catálogo de vendedores/atribución autoservicio; respaldo integral y restauración; dispositivos/PWA; fotos/WhatsApp del equipo.

Seguridad: RLS admin y escrituras sólo RPC; funciones validan auth.uid en admin_users, search_path vacío y ejecución anónima revocada. Asesor avisa cuatro RPC SECURITY DEFINER intencionales para authenticated, con bloqueo de no-admin probado: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable . Sigue pendiente protección de contraseñas filtradas: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . No hay nuevas alertas de RLS deshabilitado.

Respaldo previo de código: ClickOnMe-antes-reembolsos-e0b8eccb.zip en outputs del espacio de trabajo. No es respaldo completo de datos/Auth/Storage.

SIGUIENTE ACCIÓN EXACTA: confirmar despliegue y carga de Registrar devolución total ya realizada en Admin sin generar un reembolso ficticio. Después completar una alta externa y entrega de tarjeta con su propietario real; mantener pago real pendiente hasta tener comprobante y autorización legítimos.
