# Continuidad comercial — 28 septiembre 2026

Base revisada: main abbec08d5c1092b718751682148864598edde43c. Se conserva el proyecto Pgamenox/Clickonme y la base jjiiuvfshzdgjalmsaay.

## Bloque de esta sesión

Registro administrativo de pago asistido y activación anual atómicos; comisión del 20% del primer importe efectivo registrado por cliente. Registro de cliente, vendedor (código o nombre), plan, precio de lista, importe cobrado con centavos, descuento, método, estado recibido, folio, fecha de pago, activación, vencimiento, comisión pendiente/pagada y comprobante de comisión. Renovaciones sin comisión. Sin vendedor: sin comisión.

Se entrega primero la tarjeta a la cuenta confirmada del cliente; después se registra el cobro. El cliente puede ser captado y su tarjeta creada por el administrador antes de registrarse. La activación reutiliza admin_authorize_plan. Las cortesías siguen disponibles separadas de ingresos. No se realizaron cargos ni pagos reales.

Migración aplicada: 20260928065907 assisted_sales_receipts_and_first_commission; ajuste posterior assisted_commission_zero_rounding para redondeo menor a un centavo. Fuente reproducible: supabase/assisted-sales.sql. Es aditiva; no reemplaza funciones existentes. Respaldo anterior: outputs/ClickOnMe-antes-venta-asistida-20260928.zip en el espacio de trabajo; el ZIP contiene código, no copia completa de datos/Auth/Storage.

## Evidencia y estados

- IMPLEMENTADO: tabla privada por RLS para administradores, funciones de registro/activación y pago de comisión, formulario, reporte y exportación CSV.
- PROBADO: 19 pruebas SQL con rollback (descuento, centavos, 20%, anualidad, renovación, folios/idempotencia, permisos, comisión pagada). Cero residuos confirmados.
- PROBADO: 38 pruebas Node, incluidas concurrencia de formulario, reintento incierto y confirmación obligatoria de recepción.
- PROBADO: controles estáticos QA y seguridad locales aprobados.
- FUNCIONAL EN PRUEBA CONTROLADA: operación completa de base de datos entrega → cobro → activación → renovación → comisión pagada. No equivale a una venta real.
- FUNCIONAL EN PRODUCCIÓN (lectura y formulario): panel desplegado, listado y precios cargan; $500.50 muestra $100.10 de comisión posible. Formulario de QA limpiado sin guardar. GitHub QA, Security, Source Backup y Pages terminaron correctamente para f42f3341.
- PENDIENTE: registrar primera venta real con comprobante auténtico. No inventar ingresos para hacer QA.

## Uso de la primera venta

1. Admin: crear tarjeta en prueba y editar contenido.
2. Cliente: registrarse y confirmar correo.
3. Admin: Entregar tarjeta al correo confirmado (una tarjeta por cuenta).
4. Verificar recepción de dinero y asignar folio único. Efectivo también requiere un folio de recibo.
5. Venta asistida: elegir tarjeta entregada, plan, vendedor estable, importe, método, folio y fecha real. Explicar cualquier descuento respecto a lista.
6. Marcar recepción verificada y Registrar pago recibido y activar plan. Revisar mensaje, vencimiento y comisión en el registro.
7. Abrir tarjeta pública, compartir y mostrar QR. Verificar acceso desde cuenta del cliente.
8. Cuando efectivamente se liquide al vendedor, Registrar comisión pagada con comprobante. Este botón registra el pago; no transfiere dinero.

Si la conexión falla, reintentar exactamente el mismo folio y datos. El servidor evita repetir activación. No usar Cortesía para registrar cobros.

## Límites y siguientes bloques

- No hay primera venta real todavía. Alta externa/correo de cliente nuevo y cobro Mercado Pago completo siguen pendientes.
- Este bloque calcula comisiones de ventas asistidas; no añade atribución/comisión a una primera compra de autoservicio. Las renovaciones automáticas no generan comisión.
- El cálculo consulta cobros anteriores registrados (incluye pagos de pasarela production aprobados/reembolsados). Cobros históricos fuera del sistema requieren conciliación antes de registrar un cliente antiguo. No se inventan pagos históricos.
- Reembolso/corrección de una venta asistida y reversión/recuperación de comisión requieren siguiente bloque; no borrar ni editar registros directamente. La relación restrict evita borrar un cliente con historial asistido.
- El vendedor se guarda por código/nombre suministrado por Admin; no hay catálogo validado ni portal de vendedores todavía.
- La vigencia del plan se activa ahora por un año o extiende un año el mismo plan vigente; se conserva la regla operativa existente.
- Asesor de seguridad: dos avisos por RPC SECURITY DEFINER expuestas a authenticated. Es deliberado: comprueban auth.uid contra admin_users antes de toda operación, search_path vacío, ejecución anónima revocada, tabla sin escritura cliente. Pruebas de cliente no admin aprobadas. Revisión: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- Sigue pendiente activar protección de contraseñas filtradas: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Fallo inicial de ejecución de tests: se lanzaron desde carpeta superior y no encontraban archivos; repetidos desde la raíz real del repositorio: 38/38 aprobados. No fue fallo del producto.

SIGUIENTE ACCIÓN EXACTA: acompañar un cliente real nuevo: confirmar su correo, entregar su tarjeta y registrar un comprobante auténtico. Si aún no hay cliente/cobro, completar prueba de integración del panel con servicio simulado y probar reembolso asistido antes de ampliar autoservicio.
