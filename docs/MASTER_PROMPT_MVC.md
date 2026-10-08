# MASTER PROMPT — MVC · ME VOY CONTIGO

## Objetivo
Continuar y completar MVC — Me voy contigo como aplicación móvil iOS/Android para desplazamientos interurbanos compartidos dentro de una misma provincia. Debe conservar el diseño aprobado, el logo oficial y la arquitectura existente. No reconstruir desde cero si existe código válido.

## Principios obligatorios
1. Cada viaje debe permanecer íntegramente dentro de una sola provincia.
2. Validar la geometría completa de la ruta, no solo origen y destino.
3. Si la ruta abandona la provincia, buscar una alternativa válida o bloquear la publicación/modificación.
4. No usar distancias en línea recta para cobros ni ETA.
5. No crear endpoints ficticios, saldos falsos, botones sin acción operativa ni datos demo presentados como reales.
6. No declarar “producción” hasta que los flujos críticos, proveedores externos, economía y tratamiento legal de datos estén verificados.
7. Estados oficiales de entrega: “Implementado y probado / Implementado pendiente de verificar / Bloqueado / No implementado”.

## Perfiles
Una cuenta puede ser:
- pasajero;
- conductor;
- ambos.

La primera pantalla es la entrada a toda la app y debe permitir seleccionar pasajero, conductor o ambos.

### Pasajero
- foto pública obligatoria;
- verificación de móvil;
- búsqueda de viajes;
- solicitud de plaza;
- seguimiento;
- chat y notificaciones;
- pago cuando corresponda.

### Conductor
El registro de conductor debe requerir:
- foto pública;
- móvil verificado;
- marca del coche;
- modelo;
- matrícula;
- plazas disponibles;
- foto real del coche;
- documentación;
- seguro en vigor.

La matrícula debe normalizarse y validarse en servidor.

## Seguro del vehículo
El conductor debe aportar foto o documento del seguro.
- detectar automáticamente la fecha de caducidad cuando sea posible;
- OCR automático como ayuda, nunca como única aprobación;
- revisión manual de respaldo;
- no aprobar seguros caducados;
- guardar fecha de caducidad verificada;
- si el seguro caduca, bloquear automáticamente publicar/iniciar viajes;
- exigir renovación;
- reactivar conducción solo después de subir renovación y quedar validada;
- registrar auditoría del proceso.

## Biometría
La biometría facial permanece desactivada hasta definir y aprobar de forma expresa finalidad, base jurídica, retención, proveedor y vía alternativa.

## Vehículos
- conductor propietario;
- matrícula única normalizada;
- revisión del vehículo;
- documentación;
- foto;
- seguro;
- capacidad máxima;
- nunca permitir ofrecer más plazas que las del vehículo.

## Viajes
- puntuales y recurrentes;
- ida/vuelta independientes;
- provincia;
- origen;
- destino;
- categoría: Trabajo, Universidad, FP/Academias, Hospital, Deporte, Otros;
- días/horas;
- paradas;
- puntos de encuentro;
- flexibilidad;
- desvío máximo;
- plazas.
- conductor acepta/rechaza solicitudes.
- solicitud pendiente != reserva confirmada.
- reserva confirmada = aceptación conductor + confirmación de pago del proveedor.
- capacidad por tramo.
- transacciones seguras frente a concurrencia.

## Viaje flexible
- el viaje puede retrasarse dentro de la flexibilidad configurada;
- puede admitir nuevos pasajeros durante el trayecto si hay capacidad por todos los segmentos afectados;
- debe recalcularse ruta/ETA/coste;
- cambios materiales de precio/horario deben ser aceptados por los pasajeros afectados;
- el tráfico solo cambia ETA, nunca genera recargo automático.
- no activar recargos arbitrarios de última hora sin regla aprobada y versionada.

## Mapa y ubicación
- mapa público con coches disponibles;
- posición pública aproximada;
- posición precisa solo para usuarios autorizados;
- marcar GPS obsoleto/stale;
- mostrar ETA de recogida, minutos, distancia por carretera, última actualización y alertas de proximidad;
- permitir solicitar plaza durante un viaje activo solo si es alcanzable, provincial, con capacidad, dentro del desvío permitido y con consistencia transaccional.

## Motor económico
Propuestas NO activadas hasta aprobación:
- 0,30 €/km;
- comisión 1 % conductor;
- posible 1 % pasajero;
- posible 1 % + 1 %;
- Premium mensual.

El motor debe:
- usar enteros exactos;
- estar versionado;
- separar contribución, comisión, procesamiento, impuestos, total y neto;
- calcular por km reales de carretera entre recogida y destino;
- ida y vuelta por separado;
- conservar snapshots de cotización.

## Pagos
Objetivo propuesto:
- cobro semanal al pasajero;
- liquidación mensual al conductor;
- proveedor regulado;
- no custodiar fondos fuera del proveedor;
- webhooks firmados;
- idempotencia;
- eventos tardíos/fuera de orden;
- devoluciones;
- disputas;
- conciliación;
- ledger;
- estados pendiente/disponible;
- nunca presentar modo test como operación real.

## Cancelaciones
Política configurable y versionada. No asumir que la empresa siempre cobra hasta que la política final esté aprobada.

## Comunicación
- chat asociado a viaje/reserva autorizada;
- notificaciones push e in-app;
- bloqueo/reporte;
- código de recogida;
- inicio/fin de viaje;
- incidencias;
- valoraciones.

## Administración
Panel protegido para:
- usuarios;
- verificaciones;
- vehículos;
- documentos;
- viajes;
- solicitudes;
- reservas;
- pagos;
- devoluciones;
- payouts;
- reportes;
- tarifas;
- términos;
- auditoría;
- estado de integraciones.

No crear contraseña maestra ni acceso administrativo oculto.

## Backend
- Node/TypeScript;
- PostgreSQL/PostGIS;
- migraciones;
- restricciones de integridad;
- transacciones;
- locking por tramo;
- OpenAPI;
- autorización por recurso;
- rate limits;
- secretos por entorno;
- archivos privados;
- URLs firmadas;
- monitorización;
- backups;
- restore;
- deploy/rollback.

## Frontend
- Expo SDK 57;
- iOS/Android;
- logo oficial MVC;
- mantener branding azul + menta;
- diseño responsive;
- no usar prototipos como si fueran datos reales;
- botones Volver/Atrás donde proceda;
- conservar estado al volver;
- pantallas para onboarding, registro, perfiles, vehículo, búsqueda, mapa en vivo, viaje, solicitudes, pagos, mensajes, incidencias, cancelaciones, perfil, notificaciones.

## Almacenamiento privado
- S3-compatible;
- proveedor desactivado si no hay credenciales reales;
- intención de subida;
- URL firmada temporal;
- verificación del objeto subido;
- SHA-256;
- ownership por usuario;
- descarga temporal;
- límite de tamaño;
- tipos permitidos.

## OCR seguro
- OCR de seguro opcional;
- Google Vision u otro proveedor real configurable;
- detectar fecha de caducidad;
- guardar confianza;
- si confianza insuficiente, revisión manual;
- nunca aprobar automáticamente un seguro caducado.

## Pruebas obligatorias
Cubrir como mínimo:
- ruta con extremos dentro pero geometría fuera;
- ruta provincial válida;
- concurrencia de plazas;
- solicitudes en segmentos no solapados;
- hold expirado;
- pago tardío;
- webhook duplicado/tardío/fuera de orden;
- cancelación/refund/payout;
- recogida durante viaje;
- aceptación/rechazo de cambio de ruta;
- pérdida de GPS;
- acceso no autorizado a ubicación/chat/admin;
- backup/restore;
- seguro caducado;
- renovación de seguro;
- foto de coche ausente;
- almacenamiento privado;
- OCR con fecha válida, dudosa y caducada.

## Entrega
Mantener:
- código fuente completo;
- frontend;
- backend;
- migraciones;
- tests;
- documentación;
- README;
- OpenAPI;
- prompt maestro;
- logo;
- configuración .env.example;
- CI;
- instrucciones de despliegue;
- evidencia real de pruebas;
- lista de bloqueos pendientes.

Nunca inventar credenciales, servidores, proveedores ni resultados de pruebas.
