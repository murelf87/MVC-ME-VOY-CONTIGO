# Eliminación de cuenta

Cualquier persona puede eliminar su cuenta desde la app (Perfil › Eliminar mi cuenta), como exigen
App Store y Google Play.

## Antes de eliminar
`GET /v1/me/account/deletion` dice si se puede y, si no, por qué. No se puede mientras:

| Código | Motivo |
|---|---|
| `OPEN_TRIPS_AS_DRIVER` | Tiene viajes publicados o en marcha como conductor. |
| `OPEN_BOOKINGS` | Tiene solicitudes o reservas en viajes que no han terminado. |
| `REFUNDS_PENDING` | Se le debe un reembolso o una compensación. |
| `DRIVER_BALANCE_UNSETTLED` | Tiene ganancias pendientes, disponibles o en camino. |
| `LAST_ADMIN` | Es la única persona con rol `admin`. |

Así nadie se queda tirado en un viaje y no queda dinero sin liquidar.

## Qué se borra al momento
`POST /v1/me/account/delete` con `{"confirm":"BORRAR"}`, en una sola transacción:
- Teléfono (queda libre: si vuelve a registrarse, es una cuenta nueva sin relación con la anterior).
- Nombre visible, foto pública y selfie.
- Documentos privados y subidas pendientes: se quitan de la base y sus ficheros pasan a `storage_purge_queue`; `npm run storage:purge` los borra del almacenamiento y reintenta los que fallen. Debe programarse cuando haya almacenamiento privado configurado.
- Sesiones (se cierra en todos los dispositivos), roles, avisos, móviles registrados para push y bloqueos.
- Borradores de viaje (pasan a cancelados), series recurrentes (terminadas) y desvíos pedidos sin resolver (cancelados).
- Queda en la auditoría como `user.deleted`.

## Qué se conserva, sin datos que identifiquen a la persona en MVC
Viajes, reservas, cobros, reembolsos, libro contable, payouts, valoraciones, reportes, mensajes de chat
y posiciones GPS de viajes pasados, y las aceptaciones de condiciones. Siguen enlazados a un
identificador interno que ya no tiene teléfono ni nombre.

Motivo: contabilidad y obligaciones fiscales, disputas de pago y investigaciones de seguridad de otras personas.

## Pendiente de decidir (BLOCKERS 13)
Cuánto tiempo se guarda cada una de esas cosas y cuándo se purgan del todo (por ejemplo, el chat y
el GPS antes que la contabilidad). Lo debe fijar vuestro asesor según el RGPD y la normativa fiscal;
hasta entonces no se borra nada automáticamente. La matrícula del vehículo también se conserva con
los viajes hechos.
