# Autenticación y sesiones

## Estado
El backend implementa autenticación por teléfono con un adaptador de proveedor real y sesiones opacas revocables.

Por defecto `SMS_PROVIDER=disabled`; en ese modo no se envía ningún código y el endpoint de inicio responde con proveedor no disponible. No existe ningún OTP maestro ni código de prueba universal.

## Twilio Verify
Para activar el adaptador incluido:
- `SMS_PROVIDER=twilio`
- `TWILIO_API_KEY_SID`
- `TWILIO_API_KEY_SECRET`
- `TWILIO_VERIFY_SERVICE_SID`

El número se exige/normaliza a E.164. El backend inicia una verificación SMS y conserva solo el identificador de challenge del proveedor; el código se valida contra Verify y no se almacena localmente.

## Sesiones
Tras una verificación aprobada se crea un token aleatorio `mvc_sess_*`. La base de datos guarda exclusivamente SHA-256 del token, nunca el token en claro. Las sesiones tienen expiración y pueden revocarse con logout.

## Roles
El registro público solo puede solicitar `passenger`, `driver` o ambos. Los roles administrativos no pueden obtenerse desde los endpoints públicos de autenticación.

## Endpoints
- `POST /v1/auth/phone/start`
- `POST /v1/auth/phone/verify`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`
