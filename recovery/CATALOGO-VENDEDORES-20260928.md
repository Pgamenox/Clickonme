# Catálogo, comisiones y comunicación anual

Base: dc2fce879b5a3f6ae457d2047ef5dfc3eba2182a. Mismo Admin y base; no se reorganizaron ni retiraron QA, bitácora, historial, devoluciones o controles existentes.

IMPLEMENTADO
- Catálogo sales_representatives persistente con UUID, nombre, código único permanente, activo/inactivo, porcentaje predeterminado 20 y fecha de alta. Alta/edición administrativa con auditoría; sin borrado.
- Venta asistida usa selector de vendedores activos o Venta directa / Sin comisión. Relación seller_id con FK; conserva código/nombre/porcentaje históricos por recibo.
- RPC admin_record_catalog_sale sustituye la entrada de texto libre. La rutina anterior permanece interna, con revocación de ejecución cliente después del despliegue. No eliminarla: el nuevo servicio la reutiliza para activación/refund snapshot.
- Reporte/CSV identifica cliente, tarjeta ID, vendedor ID/nombre/código, plan, cobro, porcentaje, comisión, fecha y estado. Comisiones pagadas y devoluciones conservadas.
- Comisión predeterminada 20% del primer cobro efectivo registrado; renovaciones y venta directa 0. Porcentaje editable por administrador para nuevas ventas, sin cambiar recibos históricos.
- Portada, seis kits y checkout especifican MXN / año, Un solo pago y Vigencia de 12 meses. Sin cambiar precios: 600/700/850/999.

PROBADO
17 verificaciones SQL con rollback: crear vendedor QA, duplicado rechazado, crear prospecto, editar descripción, asignar a cuenta QA confirmada, cobrar con seller_id, activar 12 meses, comisión de 100 sobre 500, historial pagado inmutable frente a cambios de vendedor, inactivo rechazado, renovación sin comisión, Creator directo 999/12 meses/sin comisión, lectura administrativa y bloqueo de cliente/anon. No persisten vendedores ni ventas QA.
21 pruebas focalizadas de código (formulario asistido, precios y pasarela), incluidos seller_id, venta directa y catálogo indisponible. QA/seguridad estáticos aprobados. Las pruebas de base y de formulario son capas separadas: no equivalen al recorrido completo por navegador con backend real.

PUBLICACIÓN / CONTINUIDAD
Publicado bloque 3c2fd9db, QA/Security/Backup/Pages aprobados. Catálogo y selector comprobados en navegador; portada muestra precios actuales y texto anual explícito. Aplicada migración sales_representatives_catalog_and_sale_attribution y cerrado el acceso de texto libre después de verificar el despliegue:
revoke execute on function public.admin_record_assisted_sale(uuid,bigint,text,numeric,text,text,text,timestamptz,text) from authenticated;

NO PROBADO
Recorrido completo por interfaz desde crear prospecto hasta ver venta/ comisión persistida en backend real. Prueba de cargo Mercado Pago real pendiente de autorización expresa. No se crearon cargos o transferencias.

RIESGOS / LÍMITES
Catálogo inicialmente vacío: Pablo debe dar de alta vendedores reales. Venta directa funciona sin vendedor. El selector bloquea guardado si el catálogo no carga. No se alteraron perfiles antiguos ni cortesías. No hay clientes pagados activos sin vencimiento en consulta actual.
Avisos de SECURITY DEFINER en RPC autenticadas deliberadas: auth.uid/admin_users, RLS, search_path vacío y anon revocado; cliente sin privilegios rechazado. Persisten contraseñas filtradas deshabilitadas. Ver https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable y https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .

SIGUIENTE ACCIÓN EXACTA
Completar QA integral de interfaz en entorno aislado que no contabilice cobros de prueba como ingresos reales. El flujo SQL ya probado sirve de referencia; no declarar completada la prueba visual por esos resultados. Mantener pago real pendiente de Pablo.
