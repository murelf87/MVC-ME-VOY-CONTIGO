# Bloqueos reales

1. **Frontend móvil**: no se ha recuperado un repositorio/ZIP de código fuente aprobado; solo maquetas. No se inventarán contratos móviles.
2. **SMS operativo**: el adaptador Twilio Verify está implementado y probado estructuralmente, pero faltan credenciales/configuración propias de MVC para enviar SMS reales.
3. **Almacenamiento privado**: proveedor y credenciales pendientes para fotos públicas, selfies privadas y documentos.
4. **Routing/geocoding/tráfico**: falta seleccionar/configurar proveedor real.
5. **Pagos/payouts**: falta seleccionar/configurar proveedor marketplace real y completar webhooks, conciliación, reembolsos y payouts.
6. **Provincias**: falta aprobar/importar un dataset oficial o trazable con fuente, fecha y licencia.
7. **Biometría facial**: permanece desactivada hasta definir finalidad, base jurídica, proveedor, conservación y vía alternativa.
8. **Economía**: 0,30 €/km, 1 % de comisión, Premium, topes y retención de comisión en cancelaciones siguen siendo propuestas, no reglas activas.

La falta de Docker local en el PC ya no bloquea las pruebas del backend: GitHub Actions ejecuta PostgreSQL/PostGIS real en CI.
