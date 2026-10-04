# PROMPT MAESTRO — MVC “ME VOY CONTIGO”

## Misión
Continúa y completa **MVC – Me voy contigo** como una aplicación real iOS/Android de viajes compartidos interurbanos dentro de una misma provincia española. No reconstruyas desde cero lo que ya exista y esté aprobado. Inspecciona primero código, contratos, migraciones, pruebas, maquetas y configuración. Conserva lo válido y cambia solo lo necesario.

No crees demos falsas, endpoints ficticios, saldos simulados ni botones sin backend. No inventes credenciales ni servidores. Distingue siempre entre:
- Implementado y probado.
- Implementado pendiente de verificar.
- Bloqueado.
- No implementado.

No declares “producción lista” hasta que los flujos críticos, integraciones, proveedores, decisiones económicas, privacidad y tratamiento de datos estén realmente verificados.

---

## 1. Modelo del producto
MVC permite que conductores y pasajeros compartan desplazamientos interurbanos dentro de una provincia, por ejemplo trabajo, universidad, FP/academias, hospital, deporte u otros destinos.

Un usuario puede usar la misma cuenta como pasajero y como conductor. Ambos perfiles deben tener fotografía pública. La plataforma debe permitir viajes puntuales y rutas recurrentes, incluida reserva semanal.

Categorías:
- Trabajo.
- Universidad.
- FP / Academias.
- Hospital.
- Deporte.
- Otros destinos.

---

## 2. Regla geográfica obligatoria
Cada viaje debe permanecer **íntegramente dentro de una única provincia**.

Validar en backend:
- provincia del viaje;
- origen;
- destino;
- todas las paradas;
- puntos de recogida;
- puntos de bajada;
- geometría completa de la ruta por carretera;
- viaje de ida y vuelta de forma independiente.

No basta con comprobar que origen y destino estén dentro. Debe comprobarse que la geometría completa del itinerario calculado por un proveedor real de routing no abandone la provincia.

Usar límites provinciales oficiales o trazables, guardando:
- fuente;
- URL;
- fecha;
- licencia;
- versión o identificador si existe.

Si la ruta rápida abandona la provincia, intentar una alternativa que permanezca dentro. Si no existe una ruta válida, bloquear la publicación o reserva con un error claro.

No usar distancia en línea recta para cobrar. Precio, distancia y ETA deben basarse en recorrido real por carretera.

---

## 3. Registro, perfiles e identidad
Registro y recuperación de sesión reales. Si el frontend usa teléfono, integrar un proveedor SMS real; nunca códigos universales de prueba en producción.

Separar:
- fotografía pública del perfil;
- selfie privada;
- prueba de vida;
- identidad/KYC;
- documentos;
- revisión administrativa.

La fotografía pública debe ser visible según reglas del producto. Selfies, documentos y verificaciones deben ir a almacenamiento privado con autorización y auditoría.

No activar biometría facial hasta que estén definidos y aprobados:
- finalidad;
- base jurídica;
- proveedor;
- conservación;
- eliminación;
- alternativa para quien no pueda/no quiera usarla.

No crear contraseñas maestras ni puertas traseras de administrador.

---

## 4. Conductores y vehículos
Para publicar un viaje, el backend debe exigir:
- perfil de conductor válido;
- foto pública aprobada;
- identidad verificada conforme a la política vigente;
- vehículo aprobado;
- documentación del vehículo aprobada;
- número de plazas válido.

Las plazas ofrecidas nunca pueden superar las plazas de pasajeros del vehículo.

El conductor puede decidir aceptar o rechazar solicitudes. Una solicitud aceptada todavía no equivale a reserva confirmada.

---

## 5. Creación y publicación de viaje
Un viaje puede configurar:
- provincia;
- origen;
- destino;
- categoría;
- fecha/días;
- hora;
- ida;
- vuelta independiente;
- paradas/puntos de encuentro;
- desvío máximo;
- flexibilidad temporal, hasta una hora según reglas del producto;
- plazas ofrecidas;
- recurrente o puntual.

Guardar geometría, distancia y duración devueltas por un proveedor de routing real y una referencia/versionado de esa ruta.

No publicar si la ruta no está verificada geográficamente.

---

## 6. Búsqueda, solicitudes y reservas
Flujo mínimo:
1. pasajero busca viaje;
2. solicita plaza;
3. conductor acepta o rechaza;
4. aceptación crea posibilidad de hold temporal, no reserva;
5. backend bloquea capacidad por los segmentos afectados;
6. pago se confirma del lado del servidor mediante proveedor real;
7. solo entonces existe reserva confirmada.

Estados explícitos y auditables.

Capacidad por segmento, no solo por viaje completo.

Evitar overbooking con transacciones y bloqueos de filas/segmentos. Deben soportarse solicitudes concurrentes.

Si el hold expira antes de llegar el pago, un pago tardío no debe forzar una reserva: crear compensación/reembolso o revisión según integración de pagos.

---

## 7. Viajes recurrentes y reserva semanal
Permitir rutas habituales con días/horas definidos.

El pasajero debe poder reservar plazas para una semana según disponibilidad real de cada ocurrencia.

La orquestación recurrente no puede crear dobles reservas ni exceder capacidad.

---

## 8. Economía
El sistema debe ser configurable y versionado. Nunca codificar como decisión final cifras no aprobadas.

Propuestas históricas actualmente NO activadas:
- 0,30 €/km;
- 1 % al conductor;
- posible 1 % al pasajero;
- opción 1 % + 1 %;
- Premium mensual;
- topes de coste compartido.

Representar dinero en unidades enteras exactas, nunca `float`.

Mantener separados:
- aportación por trayecto;
- comisión pasajero;
- comisión conductor;
- procesamiento;
- impuestos;
- total pasajero;
- neto conductor.

Documentar reglas de redondeo.

El coste de cada pasajero se calcula sobre kilómetros reales por carretera entre su punto de recogida y su destino, no necesariamente sobre todo el viaje.

Ida y vuelta se calculan independientemente.

---

## 9. Pagos, cobros y payouts
Preferencia funcional:
- cobro/liquidación de pasajeros con periodicidad semanal cuando el modelo final lo permita;
- pagos a conductores con periodicidad mensual.

Elegir una plataforma de pagos apta para marketplace y payouts a terceros. MVC no debe custodiar fondos fuera del proveedor regulado.

Implementar:
- webhooks firmados;
- idempotencia;
- tolerancia a eventos duplicados;
- eventos fuera de orden;
- reembolsos;
- disputas;
- conciliación;
- ledger;
- saldos pendientes frente a disponibles;
- payout;
- estado de cada operación.

Si no hay credenciales, usar entorno de test oficial del proveedor, pero marcar la integración como bloqueada/no operativa; no simular que funciona en producción.

---

## 10. Cancelaciones
La política debe ser configurable y versionada.

La preferencia de negocio es que MVC pueda conservar su comisión en determinados supuestos, pero **no convertirlo en una regla absoluta** hasta validación jurídica/comercial.

Distinguir:
- cancelación del pasajero;
- cancelación del conductor;
- cancelación de plataforma;
- fuerza mayor;
- no-show;
- viaje ya iniciado;
- pago realizado/no liquidado;
- payout ya enviado.

Aplicar reembolso/retención conforme a la versión de política aceptada por el usuario.

---

## 11. Viaje flexible y cambios de ruta
Un viaje puede sufrir retrasos de hasta la flexibilidad configurada o admitir nuevos pasajeros durante el trayecto.

Nunca aplicar un “recargo por molestias de última hora” automático.

Si un nuevo pasajero obliga a recalcular:
- ruta;
- km;
- ETA;
- paradas;
- coste;
debe recalcularse de forma objetiva.

El tráfico cambia ETA, no genera recargo.

Si un cambio altera materialmente precio u horario previamente acordado, debe proponerse a los pasajeros afectados y requerir su aceptación antes de aplicarlo.

---

## 12. Solicitud durante viaje en marcha
Permitir que alguien reserve mientras el coche ya está en ruta solo si:
- el punto es alcanzable;
- permanece dentro de la provincia;
- existe capacidad en todos los segmentos afectados;
- el desvío respeta el máximo permitido;
- los pasajeros afectados aceptan cambios materiales;
- el pago y reserva se completan de forma atómica;
- no hay carreras que provoquen overbooking.

---

## 13. Mapa en directo
La experiencia debe mostrar coches y disponibilidad sobre mapa real.

Privacidad por defecto:
- usuarios públicos/no autorizados: posición aproximada, nunca coordenada precisa innecesaria;
- pasajeros autorizados del viaje: ubicación precisa cuando sea necesaria para recogida/seguimiento.

Mostrar:
- coche;
- plazas disponibles;
- estado;
- ETA de recogida;
- minutos restantes;
- distancia por carretera;
- hora de última actualización;
- proximidad;
- aviso de llegada.

GPS:
- timestamp;
- orden de eventos;
- tolerancia a reconexión;
- rate limiting;
- indicador de posición obsoleta;
- límites del background tracking en iOS/Android.

No mostrar como “en directo” una ubicación antigua.

---

## 14. Comunicación y seguridad en viaje
Implementar:
- chat entre personas autorizadas;
- notificaciones push/in-app;
- bloquear/reportar;
- código de recogida;
- inicio/final de viaje;
- incidencias;
- valoración posterior.

Aplicar autorización por recurso: nadie puede leer chats, posiciones, reservas o datos privados de viajes ajenos.

---

## 15. Panel administrativo
Panel privado con roles y auditoría para:
- usuarios;
- identidad/verificación;
- fotografías;
- vehículos;
- documentos;
- viajes;
- solicitudes;
- reservas;
- cobros;
- reembolsos;
- disputas;
- payouts;
- incidencias/reportes;
- tarifas;
- condiciones/políticas;
- integraciones;
- auditoría.

Separar permisos de administración, verificación, finanzas y soporte cuando proceda.

No usar una contraseña maestra oculta.

---

## 16. Contratos e interoperabilidad
Mantener:
- OpenAPI;
- tipos;
- contratos de eventos;
- estados;
- errores estables;
- versionado.

Antes de crear endpoints, revisar el frontend aprobado. No inventar endpoints porque un botón “parezca” necesitarlos.

El backend debe ser interoperable con la app iOS/Android y responder exactamente a los contratos acordados.

---

## 17. Seguridad de plataforma
Incluir:
- autorización por recurso;
- validación de entrada;
- rate limiting;
- almacenamiento seguro de secretos;
- claves nunca incluidas en repositorio;
- archivos privados;
- URLs firmadas cuando proceda;
- auditoría de operaciones sensibles;
- separación dev/staging/prod;
- logs sin datos sensibles innecesarios;
- monitorización;
- backups;
- prueba de restauración;
- despliegue y rollback.

---

## 18. Pruebas obligatorias antes de producción
Como mínimo:
1. ruta con extremos dentro pero geometría que sale de provincia -> bloquear;
2. ruta completamente dentro -> permitir;
3. concurrencia por último asiento -> una sola reserva;
4. capacidad correcta por segmentos no solapados;
5. expiración de hold seguida de pago tardío -> no overbooking y compensación;
6. webhook de pago duplicado -> idempotente;
7. webhooks tardíos/fuera de orden;
8. cobro semanal con incidencias/no-show;
9. cancelación y reembolso según política versionada;
10. payout mensual;
11. solicitud de recogida con viaje activo;
12. recálculo de ruta aceptado;
13. recálculo rechazado;
14. pérdida/reconexión GPS;
15. acceso no autorizado a ubicación;
16. acceso no autorizado a chat;
17. acceso no autorizado a administración;
18. restauración real de backup.

No sustituir estas pruebas por mocks que oculten errores transaccionales/geoespaciales.

---

## 19. Entregables
Entregar:
- código fuente;
- migraciones;
- configuración sin secretos;
- OpenAPI;
- contratos/eventos;
- instrucciones móviles;
- instrucciones de despliegue;
- pruebas automáticas;
- evidencia de ejecución;
- inventario de integraciones;
- bloqueos;
- decisiones pendientes.

Cada entrega debe indicar explícitamente:
- Implementado y probado.
- Implementado pendiente de verificar.
- Bloqueado.
- No implementado.

---

## 20. Regla de trabajo autónomo
Avanza bloque por bloque sin detenerte por decisiones que puedan representarse como configuración pendiente. Cuando falten credenciales o una decisión externa, implementa el contrato seguro, deja la integración desactivada y documenta el bloqueo.

No sustituyas proveedores reales por falsos. No inventes que una operación se completó.

No destruyas ni modifiques otros proyectos o servicios del equipo, especialmente contenedores o infraestructura de PrivilegeFans/EmgSOS.

La prioridad es una base coherente, transaccional, geoespacial, auditable y segura que pueda convertirse en producción sin tener que rehacer su lógica central.
