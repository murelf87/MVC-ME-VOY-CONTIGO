# Bloqueos reales

1. SMS real: adaptador Twilio Verify implementado; credenciales no activadas.
2. Maps real: Google Routes/Geocoding implementado; falta clave restringida/configuración real.
3. Provincias: falta seleccionar y aprobar dataset oficial definitivo con fuente, licencia, fecha y versión.
4. Storage privado: falta proveedor para fotos/documentos, carga segura y URLs firmadas. No existe endpoint que confíe en claves de storage enviadas por el cliente.
5. Pagos/payouts: el núcleo está hecho (libro contable, webhooks firmados de Stripe, reembolsos, disputas, conciliación y pagos mensuales; ver docs/PAYMENTS.md). Falta elegir y contratar el proveedor, sus claves, el cobro desde la app y la orden de transferencia a cada conductor.
6. Push: falta proveedor/configuración.
7. Biometría facial: desactivada hasta resolver finalidad, base jurídica, proveedor, conservación, eliminación y alternativa.
8. Economía: no se activan 0,30 €/km, 1 %, Premium, topes ni retenciones sin decisión aprobada.
9. Cancelaciones: el sistema de políticas versionadas está hecho; falta que Finanzas cree y active la política final.
11. Disputas y no-shows: falta decidir quién asume una disputa perdida y qué pasa con el pago de un pasajero que no se presenta.
10. Frontend móvil: no está disponible el código fuente móvil aprobado para una validación final de interoperabilidad.
12. Textos legales: el sistema de condiciones de uso y aviso de privacidad versionados está hecho (docs/ADMIN.md, sección Condiciones). Falta el texto redactado por vuestro asesor; MVC no publica ninguno propio.
