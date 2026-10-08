# Entorno local completo (solo desarrollo)

Permite recorrer la app de punta a punta sin credenciales reales. Nada de esto
sirve para producción: cada pieza se niega a arrancar fuera de `NODE_ENV=development`.

| Pieza | Valor | Qué hace |
|---|---|---|
| SMS | `SMS_PROVIDER=dev_console` | Genera un código aleatorio de 6 cifras por intento y lo escribe en el log del servidor (`[DEV SMS] +34… code=…`). Sin códigos universales. |
| Mapas | `MAPS_PROVIDER=dev_local` | Geocodifica un nomenclátor fijo de localidades de Sevilla y estima rutas con un factor de desvío fijo. Las rutas llevan la etiqueta `dev_local_estimate`; no sirven para cobrar. |
| Revisión de conductor | `npm run dev:approve-driver -- +34600000000` | Sustituye la revisión administrativa (panel pendiente): aprueba foto, identidad y vehículos. |
| Pago | `npm run dev:confirm-payment -- <rideRequestId>` | Llama a `confirmProviderPayment`, la misma función que usará el webhook firmado, con un pago `dev_manual_*` de 0 céntimos. |
| Provincias | `npm run provinces:import -- fichero.geojson` | Para pruebas locales puede usarse cualquier GeoJSON provincial; en producción solo el dataset oficial del IGN/CNIG (ver `PROVINCE_DATA.md`). |

## Pasos
1. PostgreSQL 16+ con PostGIS 3.
2. `.env.dev.local` con `NODE_ENV=development`, `DATABASE_URL`, `SMS_PROVIDER=dev_console`, `MAPS_PROVIDER=dev_local`.
3. `npm install && npm run db:migrate` e importar provincias.
4. `npm run dev`.
5. Móvil: `EXPO_PUBLIC_API_URL=http://<IP>:3000 pnpm start` en `mobile/`.
6. Entrar con un teléfono, leer el código en el log del servidor, publicar como conductor tras `dev:approve-driver`, solicitar plaza con otra cuenta, aceptar y confirmar el pago con `dev:confirm-payment`.
