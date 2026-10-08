# Autenticación y sesiones

## Estado
Se entra con **correo y contraseña** (desde 2026-10-08 sustituye al acceso por SMS a petición de Marina).
No hay contraseña maestra, código universal ni puerta trasera.

## Contraseñas
- Mínimo 10 caracteres, máximo 128; se rechazan las solo numéricas o con menos de 4 caracteres distintos.
- Se guardan con scrypt (N=2^15, r=8, p=1, sal aleatoria de 16 bytes). Los parámetros van en el propio hash para poder subirlos.
- Entrar con una contraseña errónea y con un correo que no existe da la misma respuesta (`INVALID_CREDENTIALS`) y tarda lo mismo.
- Tras 5 fallos seguidos la cuenta no deja entrar durante 15 minutos (`AUTH_TEMPORARILY_LOCKED`). Configurable con `AUTH_MAX_FAILED_LOGINS` y `AUTH_LOCK_MINUTES`.
- Las rutas de acceso tienen un límite propio de 10 peticiones por minuto e IP.

## Códigos por correo
- Al registrarse se envía un código de 6 cifras para confirmar el correo. Sin confirmar se puede usar la app; el perfil lo muestra pendiente.
- "He olvidado mi contraseña": código de 6 cifras por correo. La respuesta es siempre la misma exista o no la cuenta.
- Los códigos caducan a los 30 minutos (`AUTH_CODE_TTL_SECONDS`), admiten 5 intentos, se usan una vez y pedir otro anula el anterior (como mucho uno por minuto). Solo se guarda un hash con sal.
- Cambiar la contraseña con el código cierra todas las sesiones abiertas. Cambiarla desde el perfil exige la actual y cierra las demás sesiones.

## Proveedor de correo
`EMAIL_PROVIDER=disabled` por defecto: el registro y la entrada funcionan, pero no se envían códigos y "he olvidado mi contraseña" responde `EMAIL_PROVIDER_UNAVAILABLE`.
`dev_console` escribe el correo en el log del servidor y solo arranca con `NODE_ENV=development`.
Falta elegir el proveedor real (BLOCKERS 1).

## Sesiones
Token aleatorio `mvc_sess_*`; la base solo guarda su SHA-256. Caducan y se revocan con logout.

## Roles
El registro público solo puede pedir `passenger`, `driver` o ambos. Los roles de equipo los da un admin desde el panel; el primero, `npm run staff:grant -- correo@ejemplo.es admin`.

## Endpoints
- `POST /v1/auth/register` · `POST /v1/auth/login`
- `POST /v1/auth/email/verify` · `POST /v1/auth/email/resend`
- `POST /v1/auth/password/forgot` · `POST /v1/auth/password/reset` · `POST /v1/auth/password/change`
- `GET /v1/auth/session` · `POST /v1/auth/logout`

Las cuentas creadas antes con teléfono conservan sus datos, pero no tienen contraseña: tendrían que registrarse con correo.
