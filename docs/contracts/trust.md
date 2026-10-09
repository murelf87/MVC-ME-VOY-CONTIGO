# Contrato del módulo `trust` (identidad, foto, legal y administración)

Propietario: `be-trust`. Tipos de cable: [`mobile/src/api/types/trust.ts`](../../mobile/src/api/types/trust.ts) (fuente de verdad; los
schemas Fastify de `src/modules/trust/**` producen exactamente esos tipos). OpenAPI generado: `npm run openapi:export`.

Sirve las pantallas **05–08** (foto de perfil, comprobación privada) y **37–40** (panel de administración) del diseño, más las
páginas que faltan para producción (documentos legales, documento de identidad alternativo, expediente, auditoría).

## 0. Convenciones

- Base: `/v1/...`. Auth: `Authorization: Bearer mvc_sess_…` (sesión opaca existente). Salvo donde se indica «público».
- Error: `{ "error": { "code": "MAYÚSCULAS_SNAKE", "message": "texto es-ES", "details"?: … }, "requestId": "req-…" }`.
  `code` es la clave estable; `message` está en español (es-ES) para poder mostrarse. Validación de entrada → `400 VALIDATION_ERROR`
  con `details.issues[]` (`path`, `message`). Límite de frecuencia → `429 RATE_LIMITED`.
- Fechas: instantes ISO‑8601 UTC con milisegundos (`2026-10-05T07:12:41.000Z`). Ventanas de calendario en `Europe/Madrid`.
- Dinero: siempre `Money` de `common.ts` (`{cents, currency:"EUR", status}`), céntimos enteros. **Economía NO activada**: todo importe
  derivado sin tarifa/política aprobada es `{cents:null, status:"pending_definition"}` → la UI muestra «Por definir».
  `illustrative` solo lo emite `POST /v1/admin/tariffs/example` (texto «Ejemplo» calculado con los valores del borrador) y la vista previa.
- Paginación: cursor opaco `{ items, nextCursor }` (+ `counts` donde se indica). `limit` 1–50 (por defecto 20).
- Idioma de textos del servidor: es-ES. Nunca viajan claves de almacenamiento, teléfonos completos ni coordenadas precisas.
- Las **subidas** usan intenciones firmadas (`uploadUrl` con `PUT` + `headers`); el servidor verifica tamaño, tipo y firma binaria
  del archivo al completar. Con `PRIVATE_STORAGE_PROVIDER=disabled` todo lo que sube archivos responde
  `503 PRIVATE_STORAGE_DISABLED` y los estados exponen `uploadAvailable:false`. Los `…/complete` son idempotentes.
- Validación de entrada (Fastify/Ajv): las propiedades desconocidas del cuerpo se **descartan** (no son error) y los valores se **coercionan** al
  tipo del schema (un número donde se espera texto se acepta como texto; un array de un elemento donde se espera un escalar, también).
  Orden de comprobaciones: en **`/v1/admin/**`** primero la sesión y el permiso (`401`/`403`, el intento denegado queda auditado) y solo después la
  validación (`400 VALIDATION_ERROR`), de modo que quien no puede usar un endpoint nunca recibe el detalle de su validación; en las rutas de usuario
  (`/v1/me/**`) y públicas, primero la validación. Excepción deliberada: la puerta de la economía (`…/publish`) responde `409` antes que cualquier
  validación del identificador o del cuerpo (pero después de comprobar que quien llama es `admin`; ver §4.3).
- Caché: toda respuesta lleva `Cache-Control: no-store` salvo las públicas: documentos legales (`public, max-age=60`) y el `302` de la foto pública
  aprobada (`public, max-age=300`).
- Estados «derivados» de otros módulos se leen **a la defensiva**: si la tabla de origen aún no existe en el entorno (p. ej. `incident_reports`,
  `support_tickets`), el dato se marca `available:false` / `skippedReason:"source_unavailable"` o el endpoint responde `503 SUPPORT_UNAVAILABLE`;
  nunca se inventa un valor.

## 1. Reglas de producto que fija el módulo

1. **La selfie NO acredita identidad.** `profiles.identity_status = verified` solo lo produce un **documento de identidad aprobado por
   personal** (servicio existente `reviewPrivateDocument`). Completar la comprobación privada (selfie) nunca verifica la identidad.
2. **No hay biometría facial** (ni coincidencia ni prueba de vida automatizada): `review:"human"`, `biometricMatching:"not_activated"`.
   Se activará solo cuando estén aprobados finalidad, base jurídica, proveedor, conservación, eliminación y alternativa.
3. **Foto pública ≠ comprobación privada.** La foto pública aprobada se sirve por `GET /v1/public/users/{id}/photo` (302 a URL firmada
   corta). Selfies y documentos viven en almacenamiento privado: solo el propietario ve una vista previa firmada de lo suyo y
   el personal autorizado accede **solo** mediante `POST /v1/admin/evidence/{kind}/{id}/access` (URL firmada de 120 s + auditoría).
4. **Siempre hay alternativa** a la selfie: documento de identidad («Otra forma de verificar»). Máximo **3 intentos** de selfie.
5. **Sin texto legal inventado.** Las filas semilla de términos/privacidad/cancelación/aviso de la comprobación están como
   `draft_pending_legal_review` con texto estructural neutro. Publicarlas exige `legalReviewReference` → *Bloqueado: revisión legal*.
6. **Economía no activada.** `POST /v1/admin/tariffs/versions/{id}/publish` responde `409 ECONOMICS_ACTIVATION_DISABLED` mientras
   `ECONOMICS_ACTIVATION=disabled` (valor por defecto). Nada se activa desde este módulo salvo que se habilite explícitamente esa
   variable y se aporte `approvalReference`. Los borradores no afectan a ninguna reserva.
7. **Solo trayectos dentro de la provincia** es una restricción bloqueada a `true` (no editable).
8. **Retención y proveedor de la comprobación privada: «por definir».** No existe borrado automático ni proveedor de biometría.
9. **RBAC por recurso + auditoría.** Todo endpoint `/v1/admin/**` exige rol (matriz §3), audita lo que lee/escribe
   (`audit_events`) y los intentos denegados quedan como `admin.access_denied`. No hay contraseña maestra ni puerta trasera: los roles
   de personal se conceden solo con `scripts/grant-role.ts` (acceso a la base de datos).

## 2. Máquinas de estado

### Comprobación privada (`PrivateCheckState.state`)
```
not_started ──(1.ª selfie subida)──▶ in_review ──(personal: acepta)────▶ completed   (terminal)
                                         │  ▲
                                         │  └──(usuario sube otra selfie, intento < 3)── needs_retry
                                         ├──(personal: pide otra captura)─▶ needs_retry   (si ya van 3 intentos → rejected, MAX_ATTEMPTS_REACHED)
                                         └──(personal: rechaza)───────────▶ rejected      (terminal para la selfie; queda la alternativa)
Alternativa (documento de identidad): sin selfie, el estado se deriva del último documento:
   pendiente → in_review · aprobado → completed (+ identidad verificada) · rechazado → needs_retry
Precedencia cuando hay selfie y documento: completed > in_review > needs_retry > rejected > not_started.
```
`nextAction`: `accept_notice` (falta aceptar el aviso, pantalla 07) · `capture` (primera captura) · `retry_capture` (pantalla 08 «Repetir captura»)
· `wait_review` · `use_alternative` (sin intentos o rechazada) · `none` (completada).

### Foto de perfil (`ProfilePhotoState.state`)
`none → in_review → approved | rejected`. Una foto nueva con otra aprobada visible deja `state:"approved"` y `latest.status:"in_review"`:
la foto anterior sigue siendo la pública hasta que se apruebe la nueva (no se pierde la puerta de publicación). Una entrega pendiente
reemplazada por otra pasa a `superseded`.

### Expediente (pestañas del panel)
Elemento = `profile_photo | private_check | identity (documento) | driver_license`. Estado por elemento: `none | in_review | needs_retry |
approved | rejected` (`ReviewState`). Pestaña: `pending` si algún elemento `in_review` · si no, `rejected` si alguno `rejected` ·
si no, `approved` si alguno `approved` · el resto no aparece en la cola.

### Alertas
`open → acknowledged → resolved` (también `open → resolved`). Se deduplican por `dedupe_key` mientras estén abiertas/reconocidas.
El evaluador también cierra solo (`resolved`) las alertas «cambio de horario o precio» cuya propuesta ya no está pendiente (`autoResolved`).

### Versión de tarifa
`draft → approved → retired`. Solo `draft` es editable. `approved` únicamente vía publicación (hoy bloqueada). Publicar una versión **no retira**
las anteriores: la tarifa en vigor es la `approved` con mayor `effectiveFrom` ya alcanzado (`GET /v1/admin/tariffs` → `active`).

### Consulta de atención al cliente (`support_tickets.status`, tablas de `be-comms`)
`open` (esperando respuesta del personal) `→ answered` (el personal respondió; el disparador de comms lo fija y avisa a la persona usuaria)
`→ closed` (terminal; `409 TICKET_CLOSED` si se intenta responder). Si la persona usuaria escribe de nuevo sobre una consulta `answered`, el disparador
la devuelve a `open`; una `closed` no se reabre.

## 3. Matriz de roles (RBAC)

`A` = admin · `V` = verification_admin · `F` = finance_admin · `S` = support_admin. «usuario» = cualquier sesión válida.

| Grupo | Endpoint | Roles |
|---|---|---|
| Usuario | `/v1/me/verification`, `/v1/me/photo*`, `/v1/me/identity-check*`, `/v1/me/identity/documents/*`, `/v1/me/legal/*`, `PUT /v1/me/roles` | usuario (documentos `driver_license`: rol `driver`) |
| Público | `GET /v1/legal/documents*`, `GET /v1/public/users/{id}/photo` | sin sesión |
| Panel | `GET /v1/admin/me` | A V F S |
| Resumen | `GET /v1/admin/summary`, `…/vehicle-activity` | A F S (KPIs de finanzas: solo A F; para S → `finance:null`) |
| Revisión | `GET /v1/admin/review/users`, `…/{userId}`, `POST …/{userId}/decision` | A V |
| Evidencias | `POST /v1/admin/evidence/{kind}/{id}/access` | A V |
| Reservas | `GET /v1/admin/bookings` | A F S |
| Tarifas | `GET /v1/admin/tariffs`, `…/versions`, `POST …/example` | A F |
| Tarifas (borrador) | `PUT /v1/admin/tariffs/draft` | A F |
| Tarifas (activar) | `POST /v1/admin/tariffs/versions/{id}/publish` | A (+ puerta `ECONOMICS_ACTIVATION`) |
| Operaciones | `GET /v1/admin/operations` | A F S |
| Operaciones (editar) | `PUT /v1/admin/operations` | A |
| Alertas | `GET /v1/admin/alerts` | A F S |
| Alertas (gestionar) | `POST /v1/admin/alerts/evaluate`, `POST …/{id}/status` | A S |
| Auditoría | `GET /v1/admin/audit-events` | A |
| Legal (admin) | `GET/POST /v1/admin/legal/documents`, `POST …/{id}/publish` | A |
| Atención al cliente | `GET /v1/admin/support/tickets`, `…/{ticketId}`, `POST …/{ticketId}/reply|assign|close`, `POST /v1/admin/support/attachments/{id}/access` | A S |
| Existentes (reutilizados) | `POST /v1/admin/vehicles/{id}/review`, `POST /v1/admin/documents/{id}/review` | A V |

Sin sesión → `401`; sesión sin rol suficiente → `403 AUTH_FORBIDDEN` (+ evento `admin.access_denied`). Los roles se releen de la base de datos en
**cada** petición (`user_roles`): revocar un rol surte efecto en la siguiente llamada. El teléfono completo nunca sale a un panel (se enmascara
`+34 ••• ••• 222`). Nadie puede revisar ni abrir la documentación **propia** desde el panel (`403 SELF_REVIEW_FORBIDDEN`).

La columna «Acceso» del índice de §4 se deriva del código y la comprueba `tests/unit/trust-contract-sync.test.ts`: `A V F S` son los roles
con permiso para esa operación; `usuario` = cualquier sesión válida; `público` = sin sesión.

## 4. Endpoints

Ejemplos con datos de Sevilla. Los identificadores son ilustrativos.

### Índice (45 endpoints)

Lo comprueba `tests/unit/trust-contract-sync.test.ts`: las rutas registradas, esta tabla y los permisos del código deben coincidir.

| Método | Ruta | Acceso | Pantalla / función |
|---|---|---|---|
| GET | `/v1/me/verification` | usuario | 05–08 · estado agregado de verificación |
| PUT | `/v1/me/roles` | usuario | 05 · chips Conductor / Pasajero |
| GET | `/v1/me/photo` | usuario | 05 · estado de la foto de perfil |
| POST | `/v1/me/photo/upload-intents` | usuario | 05 · pedir subida de la foto |
| POST | `/v1/me/photo/upload-intents/{intentId}/complete` | usuario | 05 · confirmar la foto («Guardar») |
| GET | `/v1/me/identity-check` | usuario | 06–08 · estado de la comprobación privada |
| POST | `/v1/me/identity-check/upload-intents` | usuario | 06 · pedir subida de la selfie |
| POST | `/v1/me/identity-check/upload-intents/{intentId}/complete` | usuario | 06/08 · confirmar la selfie (cuenta el intento) |
| POST | `/v1/me/identity/documents/upload-intents` | usuario | 08 · «Otra forma de verificar» / permiso de conducir |
| POST | `/v1/me/identity/documents/upload-intents/{intentId}/complete` | usuario | 08 · confirmar el documento |
| GET | `/v1/public/users/{userId}/photo` | público | foto pública aprobada (302 a URL firmada) |
| GET | `/v1/legal/documents` | público | 07 · últimas versiones legales |
| GET | `/v1/legal/documents/{kind}` | público | 07 · versión vigente con su texto |
| GET | `/v1/legal/documents/{kind}/versions/{version}` | público | una versión concreta |
| GET | `/v1/me/legal/status` | usuario | qué falta por aceptar |
| GET | `/v1/me/legal/acceptances` | usuario | historial propio de aceptaciones |
| POST | `/v1/me/legal/acceptances` | usuario | 07 · aceptar una versión |
| GET | `/v1/admin/me` | A V F S | quién soy en el panel |
| GET | `/v1/admin/summary` | A F S | 37a/b · resumen con comparación de periodo |
| GET | `/v1/admin/summary/vehicle-activity` | A F S | 37 · actividad de vehículos (aproximada) |
| GET | `/v1/admin/review/users` | A V | 38a/b · cola «Usuarios y revisión» |
| GET | `/v1/admin/review/users/{userId}` | A V | 38 · expediente |
| POST | `/v1/admin/review/users/{userId}/decision` | A V | 38 · aprobar / rechazar / otra captura |
| POST | `/v1/admin/evidence/{kind}/{evidenceId}/access` | A V | 38 · ver documentación privada (URL firmada 120 s) |
| GET | `/v1/admin/bookings` | A F S | 39a/b · reservas y devoluciones |
| GET | `/v1/admin/tariffs` | A F | 40a/b · tarifa en vigor, borrador y activación |
| PUT | `/v1/admin/tariffs/draft` | A F | 40 · guardar borrador |
| POST | `/v1/admin/tariffs/example` | A F | 40 · ejemplo de aportación (sin guardar) |
| GET | `/v1/admin/tariffs/versions` | A F | 40 · historial de versiones |
| POST | `/v1/admin/tariffs/versions/{versionId}/publish` | A | 40 · activar (bloqueado por `ECONOMICS_ACTIVATION`) |
| GET | `/v1/admin/operations` | A F S | 40 · restricciones y reglas de alerta |
| PUT | `/v1/admin/operations` | A | 40 · guardar restricciones y reglas |
| GET | `/v1/admin/alerts` | A F S | 40 · alertas de operación |
| POST | `/v1/admin/alerts/evaluate` | A S | evaluar las reglas ahora |
| POST | `/v1/admin/alerts/{alertId}/status` | A S | reconocer / resolver una alerta |
| GET | `/v1/admin/audit-events` | A | visor de auditoría |
| GET | `/v1/admin/legal/documents` | A | todas las versiones legales |
| POST | `/v1/admin/legal/documents` | A | crear una versión (borrador pendiente de revisión legal) |
| POST | `/v1/admin/legal/documents/{documentId}/publish` | A | publicar con referencia de revisión legal |
| GET | `/v1/admin/support/tickets` | A S | cola de consultas de atención al cliente |
| GET | `/v1/admin/support/tickets/{ticketId}` | A S | detalle de una consulta |
| POST | `/v1/admin/support/tickets/{ticketId}/reply` | A S | responder |
| POST | `/v1/admin/support/tickets/{ticketId}/assign` | A S | asignármela / quitar asignación |
| POST | `/v1/admin/support/tickets/{ticketId}/close` | A S | cerrar |
| POST | `/v1/admin/support/attachments/{attachmentId}/access` | A S | ver un adjunto (URL firmada con auditoría previa) |

### 4.1 Verificación del usuario (pantallas 05–08)

#### `GET /v1/me/verification` — Estado de verificación (agregado)
Respuesta `TrustVerificationOverview`:
```json
{
  "roles": ["driver"],
  "photo": {
    "state": "approved",
    "required": true,
    "publicPhotoUrl": "/v1/public/users/3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01/photo?v=9c1a4e7b",
    "latest": {
      "id": "5d2f0a38-1c64-4f0e-9a77-0b3c8e1d2f03", "status": "approved",
      "submittedAt": "2026-10-05T07:12:41.000Z", "decidedAt": "2026-10-05T08:03:10.000Z",
      "reason": null, "previewUrl": null, "previewExpiresAt": null
    },
    "uploadAvailable": true
  },
  "privateCheck": { "state": "in_review", "method": "selfie", "attempts": { "used": 1, "max": 3, "remaining": 2 },
    "reason": null, "nextAction": "wait_review", "canUseAlternative": true,
    "consent": { "noticeKind": "private_check_notice", "noticeVersion": 1, "accepted": true,
                 "acceptedAt": "2026-10-05T07:15:02.000Z", "noticeLegallyReviewed": false },
    "lastAttempt": { "id": "0e7b6c52-3d1a-4a98-8f2e-91c4d5a6b704", "attemptNo": 1, "status": "in_review",
                     "submittedAt": "2026-10-05T07:16:30.000Z", "decidedAt": null, "previewUrl": null, "previewExpiresAt": null },
    "review": "human", "biometricMatching": "not_activated", "selfieAloneVerifiesIdentity": false,
    "uploadAvailable": true, "updatedAt": "2026-10-05T07:16:30.000Z" },
  "identity": { "status": "pending", "verifiedBy": null,
    "documents": [ { "id": "c4a1f9e0-6b2d-4e57-8c3a-7d1e2f3a4b05", "kind": "identity_document", "status": "in_review",
                     "submittedAt": "2026-10-05T07:20:11.000Z", "decidedAt": null, "reason": null } ],
    "driverLicense": { "id": "d8b2e0a1-7c3e-4f68-9d4b-8e2f3a4b5c06", "kind": "driver_license", "status": "in_review",
                       "submittedAt": "2026-10-05T07:22:45.000Z", "decidedAt": null, "reason": null },
    "uploadAvailable": true }
}
```
Errores: `401`. (No falla con el almacenamiento desactivado: `uploadAvailable:false`, `previewUrl:null`.)

#### `PUT /v1/me/roles` — Elegir rol (chips «Conductor / Pasajero» de la pantalla 05)
Petición `{ "roles": ["driver", "passenger"] }` (≥1; solo `passenger`/`driver`). Respuesta `{ "roles": ["driver","passenger"] }`. Audita.
Errores: `422 ROLES_INVALID` · `409 ROLE_IN_USE` (quitar `driver` con viajes publicados/en curso, o `passenger` con solicitudes/reservas abiertas) · `401`.

#### `GET /v1/me/photo` — Foto de perfil
Respuesta `ProfilePhotoState` (ver ejemplo en 4.1). `latest.previewUrl` es una URL firmada de su propia foto (5 min).

#### `POST /v1/me/photo/upload-intents` — Pedir subida de la foto (pantalla 05 «Guardar»)
Petición `{ "contentType": "image/jpeg", "sizeBytes": 482113 }` (`jpeg|png|webp|heic|heif`, ≤ 10 MiB). `201`:
```json
{ "intentId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c07", "uploadUrl": "https://mvc-private.s3.eu-west-1.amazonaws.com/users/…?X-Amz-Signature=…",
  "method": "PUT", "headers": { "content-type": "image/jpeg" }, "expiresAt": "2026-10-09T14:15:00.000Z",
  "maxSizeBytes": 10485760, "allowedContentTypes": ["image/jpeg","image/png","image/webp","image/heic","image/heif"] }
```
Errores: `503 PRIVATE_STORAGE_DISABLED` · `422 UPLOAD_TYPE_NOT_ALLOWED` (`details.allowedContentTypes`) · `422 UPLOAD_SIZE_INVALID` (`details.maxSizeBytes`) ·
`429 UPLOAD_RATE_LIMITED` (>20 intenciones/24 h) · `401`. El cuerpo se valida a propósito de forma permisiva (solo `contentType` texto y `sizeBytes` entero):
un tipo o tamaño no admitido responde estos códigos estables y no un `400` genérico, para que la UI muestre el motivo.

#### `POST /v1/me/photo/upload-intents/{intentId}/complete` — Confirmar la subida
Sin cuerpo. Verifica objeto (tamaño, tipo, firma binaria), registra la entrega en revisión humana. Respuesta `ProfilePhotoState`
(`state:"in_review"` si no había una aprobada; si la había sigue `"approved"` y `latest.status:"in_review"`). Una entrega pendiente anterior pasa a `superseded`.
Errores: `404 UPLOAD_INTENT_NOT_FOUND` (también si es de otro usuario) · `410 UPLOAD_INTENT_EXPIRED` · `409 UPLOAD_OBJECT_MISSING|UPLOAD_STORAGE_MISMATCH` ·
`422 UPLOAD_SIZE_MISMATCH|UPLOAD_TYPE_MISMATCH|UPLOAD_CONTENT_INVALID` · `503 PRIVATE_STORAGE_DISABLED`.

#### `GET /v1/me/identity-check` — Estado de la comprobación (pantalla 08)
Respuesta `PrivateCheckState`. Ejemplo de la lámina 08 («Repetir», «Intentos: 2 de 3»):
```json
{ "state": "needs_retry", "method": "selfie", "attempts": { "used": 2, "max": 3, "remaining": 1 },
  "reason": { "code": "FACE_OUT_OF_FRAME", "title": "Necesitamos otra captura",
              "message": "El rostro está fuera del marco o no se ve con claridad." },
  "nextAction": "retry_capture", "canUseAlternative": true,
  "consent": { "noticeKind": "private_check_notice", "noticeVersion": 1, "accepted": true,
               "acceptedAt": "2026-10-05T07:15:02.000Z", "noticeLegallyReviewed": false },
  "lastAttempt": { "id": "3b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c08", "attemptNo": 2, "status": "needs_retry",
                   "submittedAt": "2026-10-05T07:31:09.000Z", "decidedAt": "2026-10-05T08:02:44.000Z",
                   "previewUrl": "https://mvc-private.s3.eu-west-1.amazonaws.com/…", "previewExpiresAt": "2026-10-05T08:08:00.000Z" },
  "review": "human", "biometricMatching": "not_activated", "selfieAloneVerifiesIdentity": false,
  "uploadAvailable": true, "updatedAt": "2026-10-05T08:02:44.000Z" }
```
Estado inicial (pantalla 06 antes de aceptar el aviso 07): `state:"not_started"`, `method:null`, `attempts:{used:0,max:3,remaining:3}`,
`nextAction:"accept_notice"`, `consent.accepted:false`, `lastAttempt:null`, `updatedAt:null`.
Motivos (`reason.code`): reintento `FACE_OUT_OF_FRAME | LOW_LIGHT | IMAGE_BLURRY | FACE_COVERED | MULTIPLE_PEOPLE`;
rechazo `NOT_MATCHING_PROFILE_PHOTO | NOT_A_LIVE_PERSON | MAX_ATTEMPTS_REACHED | OTHER`. El texto de rechazo es neutro
(«No hemos podido completar la comprobación…»); la sospecha interna no se muestra al usuario.

#### Aviso de privacidad y consentimiento (pantalla 07)
El aviso es el documento legal `private_check_notice` (§4.2): `GET /v1/legal/documents/private_check_notice` devuelve el texto de la
lámina 07 por secciones (incluido «Conservación y proveedor: por definir»). La casilla «He leído y acepto el uso de mi foto según esta
información» + «Continuar» → `POST /v1/me/legal/acceptances` con `{ "kind":"private_check_notice", "version": <vigente>, "context":"private_check" }`.
Subir una selfie sin haberlo aceptado → `409 PRIVATE_CHECK_CONSENT_REQUIRED`.

#### `POST /v1/me/identity-check/upload-intents` — Pedir subida de una selfie (pantalla 06 «Iniciar»)
Petición como la de la foto (`image/*` ≤ 10 MiB). `201` `TrustUploadIntent`.
Errores: `409 PRIVATE_CHECK_CONSENT_REQUIRED|PRIVATE_CHECK_IN_REVIEW|PRIVATE_CHECK_ALREADY_COMPLETED|PRIVATE_CHECK_MAX_ATTEMPTS_REACHED|PRIVATE_CHECK_REJECTED`
(esta última: el personal rechazó la comprobación con foto; la salida es «Otra forma de verificar») ·
`503 PRIVATE_STORAGE_DISABLED` · `422 UPLOAD_TYPE_NOT_ALLOWED|UPLOAD_SIZE_INVALID` · `429 UPLOAD_RATE_LIMITED` · `401`.

#### `POST /v1/me/identity-check/upload-intents/{intentId}/complete` — Confirmar la selfie
Sin cuerpo. Cuenta el intento (comprobación bajo bloqueo: nunca más de 3). Respuesta `PrivateCheckState` con `state:"in_review"`,
`attempts.used` +1, `nextAction:"wait_review"`. Errores: los de la foto + `409 PRIVATE_CHECK_MAX_ATTEMPTS_REACHED|PRIVATE_CHECK_IN_REVIEW`.

#### `POST /v1/me/identity/documents/upload-intents` — «Otra forma de verificar» / permiso de conducir
Petición `{ "kind": "identity_document" | "driver_license", "contentType": "application/pdf", "sizeBytes": 1203344 }`
(`jpeg|png|webp|pdf` ≤ 20 MiB). `driver_license` exige rol `driver`. `201` `TrustUploadIntent`.
Errores: `409 IDENTITY_ALREADY_VERIFIED` (ya verificada) · `409 DOCUMENT_IN_REVIEW` (ya hay un documento de ese tipo pendiente) · `403 DRIVER_ROLE_REQUIRED` ·
`503 PRIVATE_STORAGE_DISABLED` · `422 UPLOAD_TYPE_NOT_ALLOWED|UPLOAD_SIZE_INVALID` · `429 UPLOAD_RATE_LIMITED`.

#### `POST /v1/me/identity/documents/upload-intents/{intentId}/complete` — Confirmar el documento
Sin cuerpo. Registra el documento con el servicio existente (`private_documents`, `identity_status = pending` para identidad) y deja el
documento en revisión humana. Respuesta `TrustDocumentUploadCompleted`:
```json
{ "document": { "id": "c4a1f9e0-6b2d-4e57-8c3a-7d1e2f3a4b05", "kind": "identity_document", "status": "in_review",
                "submittedAt": "2026-10-05T07:20:11.000Z", "decidedAt": null, "reason": null },
  "privateCheck": { "state": "in_review", "method": "identity_document", "…": "…" },
  "identity": { "status": "pending", "verifiedBy": null, "documents": [ "…" ], "driverLicense": null, "uploadAvailable": true } }
```

#### `GET /v1/public/users/{userId}/photo` — Foto pública aprobada (sin sesión)
`302` a una URL firmada de 15 min (`Cache-Control: public, max-age=300`). `PublicUser.photoUrl` de los demás módulos = ruta
`/v1/public/users/{id}/photo?v={sha256(public_photo_key)[0:8]}` solo si `public_photo_status='approved'` y `public_photo_key` no es null
(helper: `publicPhotoUrl()` en `src/modules/trust/public-photo-url.ts`). `404 PHOTO_NOT_FOUND` si no hay foto aprobada.
Es **deliberadamente pública**: cualquiera que conozca el UUID de una persona puede ver su foto de perfil **aprobada** (es la foto que ven otros usuarios
en los trayectos); nunca sirve fotos en revisión, rechazadas, selfies ni documentos, ni la foto de una cuenta que no esté activa. Tiene límite de frecuencia
(`429 RATE_LIMITED`) y, con el almacenamiento desactivado y una foto aprobada, responde `503 PRIVATE_STORAGE_DISABLED`.

### 4.2 Documentos legales

Texto semilla con `status:"draft_pending_legal_review"` y secciones estructurales («Contenido pendiente de revisión legal»);
**sin validez legal hasta que Legal lo revise** (Bloqueado). `legallyEffective` = `status==="published"`.

#### `GET /v1/legal/documents` — Últimas versiones (sin sesión)
```json
{ "items": [
  { "id": "6f0a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b09", "kind": "terms", "version": 1, "status": "draft_pending_legal_review",
    "title": "Términos y condiciones de uso", "locale": "es-ES", "legallyEffective": false, "pendingLegalReview": true,
    "effectiveFrom": null, "publishedAt": null, "contentSha256": "4f2a…" },
  { "kind": "privacy", "version": 1, "status": "draft_pending_legal_review", "…": "…" },
  { "kind": "cancellation", "version": 1, "status": "draft_pending_legal_review", "…": "…" },
  { "kind": "private_check_notice", "version": 1, "status": "draft_pending_legal_review", "…": "…" } ] }
```
«Vigente» = la última versión publicada; si no hay ninguna publicada, la versión más alta en borrador (marcada pendiente).

#### `GET /v1/legal/documents/{kind}` · `GET /v1/legal/documents/{kind}/versions/{version}`
`LegalDocument` = resumen + `sections:[{heading, paragraphs[], bullets[]}]`. Ejemplo (`private_check_notice`, texto de la lámina 07):
```json
{ "kind": "private_check_notice", "version": 1, "status": "draft_pending_legal_review", "title": "Privacidad de la comprobación",
  "sections": [
    { "heading": "Tus fotos, usos y privacidad", "paragraphs": [], "bullets": [
        "Foto visible en tu perfil: la ven otros usuarios para generar confianza en los trayectos.",
        "Comprobación privada: solo la ve el equipo de MVC para revisar tu cuenta." ] },
    { "heading": "Qué se usa y para qué", "paragraphs": [], "bullets": [
        "Comprobamos que la foto y la cuenta pertenecen a una persona real.",
        "No se muestra esta foto a otros usuarios.", "No se utiliza para ningún otro fin." ] },
    { "heading": "Conservación y proveedor: por definir", "paragraphs": [
        "El tiempo de conservación y el proveedor del servicio se definirán en próximas fases." ], "bullets": [] },
    { "heading": "Otra forma de verificar", "paragraphs": ["Puedes aportar un documento de identidad."], "bullets": [] } ],
  "…": "…" }
```
Errores: `404 LEGAL_DOCUMENT_NOT_FOUND`.

#### `GET /v1/me/legal/status` — Qué falta por aceptar
```json
{ "items": [
  { "kind": "terms", "latestVersion": 1, "status": "draft_pending_legal_review", "pendingLegalReview": true, "scope": "account",
    "accepted": true, "acceptedVersion": 1, "acceptedAt": "2026-10-05T07:01:12.000Z" },
  { "kind": "privacy", "latestVersion": 1, "status": "draft_pending_legal_review", "pendingLegalReview": true, "scope": "account",
    "accepted": false, "acceptedVersion": null, "acceptedAt": null },
  { "kind": "cancellation", "latestVersion": 1, "scope": "booking", "accepted": false, "…": "…" },
  { "kind": "private_check_notice", "latestVersion": 1, "scope": "private_check", "accepted": true, "…": "…" } ],
  "accountDocumentsAccepted": false }
```

#### `POST /v1/me/legal/acceptances` — Aceptar una versión
Petición `{ "kind": "privacy", "version": 1, "context": "registration" }`. `201` (o `200` si ya estaba aceptada: idempotente) `LegalAcceptance`:
```json
{ "id": "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e10", "documentId": "7a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c11", "kind": "privacy", "version": 1,
  "context": "registration", "acceptedAt": "2026-10-05T07:01:12.000Z", "legallyEffective": false }
```
Se guarda usuario, versión, instante y **hash HMAC de la IP** (nunca la IP; si `TRUST_IP_HASH_PEPPER` no está definido no se guarda hash).
Errores: `404 LEGAL_DOCUMENT_NOT_FOUND` · `409 LEGAL_VERSION_OUTDATED` (`details.latestVersion`) · `409 LEGAL_DOCUMENT_RETIRED`.

#### `GET /v1/me/legal/acceptances` — Historial propio
`{ "items": [ LegalAcceptance, … ] }` (más recientes primero).

### 4.3 Panel de administración

Todos con `Authorization` de personal. Cada llamada deja un evento en `audit_events` (acción indicada en la columna *Auditoría*).

#### `GET /v1/admin/me` — Quién soy en el panel (A V F S) · auditoría `admin.me.viewed`
```json
{ "userId": "a1d4f7c2-9e3b-4c58-b2d6-0f1e2d3c4b12", "displayName": "Lucía Ramos", "roles": ["verification_admin"],
  "permissions": { "summary": "none", "finance_kpis": "none", "review": "write", "evidence": "write", "bookings": "none",
                   "tariffs": "none", "tariff_activation": "none", "operations": "none", "alerts": "none", "audit": "none", "legal": "none",
                   "support": "none" } }
```
`permissions` tiene siempre las 12 claves de `AdminResource` (`none | read | write`); la app debe ocultar lo que no pueda leer. Una persona sin ningún rol de
personal recibe `403 AUTH_FORBIDDEN`.

#### `GET /v1/admin/summary` — Resumen de administración (pantalla 37) · A F S · `admin.summary.viewed`
Query: `provinceId` (uuid, opcional; omitido = todas) · `period` = `today|yesterday|last_7_days|last_30_days|this_month` (por defecto `today`).
```json
{ "generatedAt": "2026-10-09T13:41:00.000Z",
  "window": { "period": "today", "timeZone": "Europe/Madrid", "from": "2026-10-08T22:00:00.000Z", "to": "2026-10-09T13:41:00.000Z",
              "previousFrom": "2026-10-07T22:00:00.000Z", "previousTo": "2026-10-08T13:41:00.000Z" },
  "province": { "id": "0b9a8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c13", "code": "41", "name": "Sevilla" },
  "kpis": {
    "activeTrips": { "value": 42, "previous": 38, "deltaPercent": 11, "trend": "up", "available": true,
                     "definition": "Viajes publicados, en curso o completados con salida en el periodo." },
    "requests":    { "value": 18, "previous": 20, "deltaPercent": -10, "trend": "down", "available": true,
                     "definition": "Solicitudes de plaza creadas en el periodo." },
    "incidents":   { "value": null, "previous": null, "deltaPercent": null, "trend": "unavailable", "available": false,
                     "definition": "Reportes de incidencia del periodo (módulo live)." } },
  "liveNow": { "tripsInProgress": 7 },
  "finance": {
    "grossRevenue":   { "amount": { "cents": null, "currency": "EUR", "status": "pending_definition" }, "source": "none",
                        "note": "Economía no activada: sin tarifa aprobada no hay ingresos que calcular." },
    "operatingCosts": { "amount": { "cents": null, "currency": "EUR", "status": "pending_definition" }, "source": "none",
                        "note": "No existe fuente de costes operativos." },
    "result":         { "amount": { "cents": null, "currency": "EUR", "status": "pending_definition" }, "source": "none", "note": null },
    "economicsActivated": false },
  "notes": [] }
```
Reglas: `incidents.available:false` mientras no exista la tabla de incidencias de `be-live` (no se inventa un 0). `finance` es `null` para S.
`grossRevenue` = suma de comisiones (pasajero+conductor) de reservas confirmadas/completadas en el periodo **solo si hay una tarifa
`approved` en vigor**; si no, `pending_definition`. `operatingCosts` siempre `pending_definition` (no hay fuente). `result` es
`pending_definition` si cualquiera de los dos lo es. El backend nunca emite `illustrative` aquí (las «Datos ilustrativos» de la
lámina son solo de la vista previa).
Errores: `404 PROVINCE_NOT_FOUND` · `403` · `401`.

#### `GET /v1/admin/summary/vehicle-activity` — Actividad de vehículos (aproximada) · A F S · `admin.vehicle_activity.viewed`
Query: `provinceId`. Celdas de ~2 km (`gridDegrees:0.02`), solo posiciones con ≤ 10 min (`freshnessSeconds:600`), **sin identidades ni
posiciones precisas** (centro de celda):
```json
{ "generatedAt": "2026-10-09T13:41:00.000Z", "province": { "id": "0b9a8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c13", "code": "41", "name": "Sevilla" },
  "label": "Actividad de vehículos (aproximada)", "precision": "approximate", "gridDegrees": 0.02, "freshnessSeconds": 600, "totalVehicles": 21,
  "items": [ { "id": "37.38:-5.98", "kind": "cluster", "count": 12, "lat": 37.39, "lng": -5.97, "precisionMeters": 2200 },
             { "id": "37.36:-6.02", "kind": "vehicle", "count": 1, "lat": 37.37, "lng": -6.01, "precisionMeters": 2200 } ] }
```

#### `GET /v1/admin/review/users` — Cola «Usuarios y revisión» (pantalla 38) · A V · `admin.review_queue.viewed`
Query: `tab=pending|approved|rejected` (por defecto `pending`) · `role=driver|passenger` · `item=identity|private_check|driver_license|profile_photo`
(«Todos» = omitido) · `sort=recent|oldest` («Más recientes») · `cursor` · `limit`.
```json
{ "items": [
  { "userId": "3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01", "displayName": "Ana López", "firstName": "Ana",
    "photoUrl": "/v1/public/users/3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01/photo?v=9c1a4e7b", "roles": ["driver"],
    "tab": "pending", "statusLabel": "Pendiente", "submittedAt": "2026-10-05T07:22:45.000Z", "pendingCount": 2, "canDecide": true,
    "rows": [ { "key": "identity", "label": "Identidad · En revisión", "state": "in_review", "badge": null },
              { "key": "driver_license", "label": "Permiso de conducir", "state": "in_review", "badge": "Requiere revisión" },
              { "key": "profile_photo", "label": "Foto de perfil", "state": "approved", "badge": null } ] },
  { "userId": "7b9e2a10-5f33-4d8e-a1c4-2e8d9f4b6c02", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": null,
    "roles": ["passenger"], "tab": "pending", "statusLabel": "Pendiente", "submittedAt": "2026-10-05T07:20:11.000Z", "pendingCount": 1, "canDecide": true,
    "rows": [ { "key": "identity", "label": "Identidad · En revisión", "state": "in_review", "badge": null },
              { "key": "profile_photo", "label": "Foto de perfil", "state": "approved", "badge": null } ] } ],
  "nextCursor": null, "counts": { "pending": 5, "approved": 31, "rejected": 2 } }
```
Etiqueta de la fila `identity`: `DNI verificado` (aprobada) · `Identidad · En revisión` · `Identidad · Rechazada` · `Identidad · Sin enviar`.
Nota de datos: el modelo no guarda género, así que el rol se devuelve como `roles` (la UI muestra «Conductor» / «Pasajero»; el «Conductora» de la lámina es de los personajes de ejemplo).
La cola **no** se filtra por provincia (los usuarios no están asociados a una provincia en el modelo de datos): la lámina 38 tampoco muestra ese filtro.
`tab:"none"` solo aparece en `summary` del expediente/decisión: la persona no tiene nada entregado, no figura en ninguna pestaña, pero su expediente se abre igual.
Orden: `recent` = entregas más recientes primero (por defecto); `oldest` = las más antiguas primero (cola de trabajo). `counts` respeta los filtros `role` e `item`.
Errores: `400 CURSOR_INVALID` · `403`.

#### `GET /v1/admin/review/users/{userId}` — Expediente («Ver expediente») · A V · `admin.dossier.viewed`
`AdminDossier`: usuario (teléfono enmascarado), `summary` (la tarjeta), `items[]` con evidencias (`kind`,`id`; **sin URL**),
`allowedDecisions` y `reasonOptions` por elemento, vehículos (revisión con el endpoint existente) e historial. `accessNote: "Acceso a
documentación privada solo para personal autorizado de MVC."` Errores: `404 USER_NOT_FOUND`.

#### `POST /v1/admin/review/users/{userId}/decision` — «Aprobar» / «Rechazar» / pedir otra captura · A V · `admin.review.decision`
Petición `{ "decision": "approved" | "rejected" | "needs_retry", "reason"?: string, "reasonCode"?: string, "items"?: ["identity", …] }`.
Sin `items` actúa sobre **todos los elementos en revisión**. `rejected` exige `reason` (3–1000 caracteres) y `needs_retry` exige `reasonCode` (uno de
`FACE_OUT_OF_FRAME|LOW_LIGHT|IMAGE_BLURRY|FACE_COVERED|MULTIPLE_PEOPLE`); sin ellos, `422 REVIEW_REASON_REQUIRED`. `needs_retry` solo aplica a `private_check`.
`reasonCode` es opcional en `rejected` y debe ser uno de los `reasonOptions` del elemento (`422 REVIEW_REASON_CODE_INVALID`); `MAX_ATTEMPTS_REACHED` lo fija
solo el sistema. Cada elemento se decide por separado y atómicamente (el resultado informa de cada uno; un elemento no aprobable no bloquea el resto):
```json
{ "userId": "3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01",
  "results": [ { "item": "identity", "outcome": "approved", "errorCode": null, "message": null },
               { "item": "driver_license", "outcome": "skipped", "errorCode": "NOTHING_TO_REVIEW", "message": "No hay entregas pendientes de este elemento." } ],
  "summary": { "userId": "3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01", "tab": "pending", "pendingCount": 1, "…": "…" } }
```
Efectos: foto aprobada → pasa a ser la pública (`profiles.public_photo_*`); identidad aprobada → `identity_status = verified` (servicio
existente `reviewPrivateDocument`); selfie aprobada → `completed` **sin** verificar identidad; el usuario recibe una notificación in‑app
(`notifications`). Un miembro del personal no puede decidir sobre su propio expediente (`403 SELF_REVIEW_FORBIDDEN`).
Un elemento omitido lleva `outcome:"skipped"` y `errorCode` `NOTHING_TO_REVIEW` (sin entrega pendiente) o `REVIEW_ITEM_INVALID` (`needs_retry` fuera de la
comprobación privada). `summary` es `null` solo si la persona dejó de existir entre la decisión y la lectura.
Errores: `404 USER_NOT_FOUND` · `409 NOTHING_TO_REVIEW` (ningún elemento revisable; `details.results`) · `403 SELF_REVIEW_FORBIDDEN` ·
`422 REVIEW_REASON_REQUIRED|REVIEW_REASON_CODE_INVALID|REVIEW_ITEM_INVALID`.
Vehículos y documentos de vehículo: endpoints existentes `POST /v1/admin/vehicles/{id}/review` y `POST /v1/admin/documents/{id}/review`.

#### `POST /v1/admin/evidence/{kind}/{evidenceId}/access` — Ver documentación privada · A V · `admin.evidence.access_url_issued`
`kind` = `profile_photo | identity_selfie | private_document`. Petición `{ "purpose": "identity_review", "note"?: "…" }`
(`identity_review|photo_moderation|license_review|vehicle_review|support_case|legal_request`).
```json
{ "url": "https://mvc-private.s3.eu-west-1.amazonaws.com/users/…?X-Amz-Expires=120&X-Amz-Signature=…", "expiresAt": "2026-10-09T13:43:00.000Z",
  "ttlSeconds": 120, "contentType": "application/pdf", "evidence": { "kind": "private_document", "id": "c4a1f9e0-6b2d-4e57-8c3a-7d1e2f3a4b05" } }
```
La URL se firma, **se escribe la auditoría** (quién, qué, propósito, TTL, propietario) y solo entonces se devuelve; si la auditoría falla no
sale ninguna URL. Errores: `404 EVIDENCE_NOT_FOUND` · `403 SELF_REVIEW_FORBIDDEN` · `409 EVIDENCE_STORAGE_MISMATCH` · `503 PRIVATE_STORAGE_DISABLED`.

#### `GET /v1/admin/bookings` — Reservas y devoluciones (pantalla 39) · A F S · `admin.bookings.listed`
Query: `provinceId` · `period` (por defecto `last_30_days`) · `status=all|cancelled|refunded` · `cursor` · `limit`.
```json
{ "items": [ {
    "bookingId": "e5f6a7b8-c9d0-4e1f-a2b3-c4d5e6f7a814", "tripId": "f6a7b8c9-d0e1-4f2a-b3c4-d5e6f7a8b915", "status": "cancelled", "statusLabel": "Cancelada",
    "passenger": { "id": "7b9e2a10-5f33-4d8e-a1c4-2e8d9f4b6c02", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": null },
    "driver": { "id": "3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01", "displayName": "Ana López", "firstName": "Ana", "photoUrl": "/v1/public/users/…/photo?v=9c1a4e7b" },
    "tripDepartureAt": "2026-10-05T06:12:00.000Z",
    "route": { "originLabel": "Sevilla - Los Bermejales", "destinationLabel": "Sevilla - Cartuja (Universidad)" },
    "cancelledBy": "passenger", "cancelledAt": "2026-10-05T06:26:00.000Z",
    "money": { "amountPaid": { "cents": 500, "currency": "EUR", "status": "defined" },
               "proposedRefund": { "cents": null, "currency": "EUR", "status": "pending_definition" },
               "platformCommission": { "cents": null, "currency": "EUR", "status": "pending_definition" },
               "finalPassengerCost": { "cents": null, "currency": "EUR", "status": "pending_definition" } },
    "refund": { "status": "pending_definition", "actionOwner": "money" } } ],
  "nextCursor": null, "counts": { "all": 12, "cancelled": 5, "refunded": null } }
```
`amountPaid` sale de `bookings.amount_cents` (dato real). El filtro `period` se aplica a `bookings.updated_at` (último cambio de la reserva; en una cancelada, la
cancelación). Devolución propuesta, comisión de la plataforma y coste final se leen de `refund_requests` (módulo `be-money`) **solo si esa tabla existe y tiene una
propuesta para esa reserva** (`refund.status: proposed|refunded`, importes `defined`, `counts.refunded` numérico). En cualquier otro caso son «Por definir»
(`pending_definition`): `refund.status:"pending_definition"` para reservas canceladas y `"not_applicable"` para las demás, `counts.refunded:null` y el filtro
`status=refunded` devuelve vacío. No existe una política de cancelación versionada aprobada (**Bloqueado**): este módulo nunca calcula devoluciones por su
cuenta. «Revisar devolución» (las acciones) pertenece a `be-money`. `cancelledBy` se deduce de `booking_status` (`cancelled` → pasajero, `driver_cancelled` →
conductor). Errores: `404 PROVINCE_NOT_FOUND`.

#### `GET /v1/admin/tariffs` — Configuración de tarifas (propuesta) (pantalla 40) · A F · `admin.tariffs.viewed`
```json
{ "active": null,
  "draft": { "id": "a7b8c9d0-e1f2-4a3b-8c4d-e5f6a7b8c916", "version": 3, "status": "draft", "ratePerKmMicros": 300000,
             "passengerCommissionBps": null, "driverCommissionBps": null, "sharedCostCapCents": null, "premiumMonthlyCents": null,
             "effectiveFrom": null, "notes": "Propuesta pendiente de decisión", "approvalReference": null,
             "createdAt": "2026-10-04T09:00:00.000Z", "updatedAt": "2026-10-09T13:20:00.000Z",
             "createdBy": { "id": "a1d4f7c2-9e3b-4c58-b2d6-0f1e2d3c4b12", "displayName": "Lucía Ramos" }, "updatedBy": { "id": "a1d4f7c2-9e3b-4c58-b2d6-0f1e2d3c4b12", "displayName": "Lucía Ramos" } },
  "activation": { "mode": "disabled", "canPublish": false,
                  "message": "La activación de tarifas está desactivada hasta que exista una decisión económica aprobada." },
  "applyNote": "Los cambios de tarifas afectan solo a futuras reservas. No se modifican reservas confirmadas.",
  "auditNote": "Registro en auditoría privada de MVC" }
```
Borrador con la propuesta 0,18 €/km y 10 %/10 % (lámina 40b): `ratePerKmMicros:180000`, `passengerCommissionBps:1000`, `driverCommissionBps:1000`; «Por definir» = `null`.

#### `PUT /v1/admin/tariffs/draft` — «Guardar borrador» · A F · `admin.tariff_draft.saved`
Crea el borrador (versión = máx+1) o actualiza el único borrador de trabajo. Petición `AdminTariffDraftInput`:
`{ "ratePerKmMicros": 180000, "passengerCommissionBps": 1000, "driverCommissionBps": 1000, "premiumMonthlyCents": null, "notes": "Propuesta 40b" }`.
Rangos: tarifa 0–5 000 000 µ€/km (≤ 5 €/km), bps 0–10000, Premium ≥ 0 (todos pueden ser `null` = «Por definir»). Respuesta `AdminTariffVersion`.
Nunca modifica reservas ni tarifas aprobadas. Errores: `422 TARIFF_INVALID` (`details.fields`).

#### `POST /v1/admin/tariffs/example` — «Ejemplo de aportación» · A F · `admin.tariff_example.calculated`
Cálculo sin guardar: `{ "distanceMeters": 18000, "ratePerKmMicros": 300000, "passengerCommissionBps": null, "driverCommissionBps": null }`.
```json
{ "distanceMeters": 18000, "ratePerKmMicros": 300000,
  "contribution": { "cents": 540, "currency": "EUR", "status": "illustrative" },
  "passengerCommission": { "cents": null, "currency": "EUR", "status": "pending_definition" },
  "driverCommission": { "cents": null, "currency": "EUR", "status": "pending_definition" },
  "passengerTotal": { "cents": null, "currency": "EUR", "status": "pending_definition" },
  "driverNet": { "cents": null, "currency": "EUR", "status": "pending_definition" },
  "disclaimer": "Antes de gestión y del límite de gastos compartidos.", "roundingRule": "half_up_cents" }
```
Con 0,18 €/km y 10 %/10 % → `contribution` 324 (3,24 €), `passengerCommission` 32, `passengerTotal` 356, `driverCommission` 32, `driverNet` 292, todos `illustrative`.
Desviación de diseño (40b): la lámina rotula «Precio final para el pasajero (ejemplo) 3,24 €» pero 3,24 € = 18 km × 0,18 € (solo aportación);
con comisión del pasajero del 10 % el total sería 3,56 €. La API devuelve el desglose; la pantalla debe rotular 3,24 € como aportación o decidir con producto.
Redondeo: mitad hacia arriba en céntimos (`src/domain/money.ts`).

#### `GET /v1/admin/tariffs/versions` — Historial de versiones · A F · `admin.tariff_versions.listed`
`Page<AdminTariffVersion>` (más recientes primero). Query `cursor`, `limit`.

#### `POST /v1/admin/tariffs/versions/{versionId}/publish` — Activar tarifa · A · `admin.tariff.publish_attempted` / `admin.tariff.published`
Petición `{ "approvalReference": "ACTA-2026-11-03", "effectiveFrom": "2026-11-10T00:00:00.000Z" }` (el cuerpo es opcional para el cliente: ver abajo).
**Hoy: `409 ECONOMICS_ACTIVATION_DISABLED`** (valor por defecto de `ECONOMICS_ACTIVATION`). Es una **puerta dura**: responde SIEMPRE ese 409, **antes** de validar
el identificador o el cuerpo (con cuerpo ausente, `null`, vacío o inválido, y con un `versionId` inexistente o no-UUID), no modifica nada y deja el intento
auditado (`admin.tariff.publish_attempted` con `blocked:true`). Solo con `ECONOMICS_ACTIVATION=enabled` se valida `approvalReference` (≥3 caracteres),
`effectiveFrom` futuro y que la versión sea un `draft` completo (tarifa y ambas comisiones definidas) y se marca `approved` (`admin.tariff.published`).
**No retira** versiones anteriores y no toca reservas confirmadas: la tarifa en vigor es la `approved` con mayor `effectiveFrom` ya alcanzado.
Errores: `409 ECONOMICS_ACTIVATION_DISABLED|TARIFF_NOT_DRAFT` · `404 TARIFF_NOT_FOUND` · `422 TARIFF_DRAFT_INCOMPLETE|TARIFF_EFFECTIVE_FROM_INVALID|APPROVAL_REFERENCE_REQUIRED`.

#### `GET /v1/admin/operations` · `PUT /v1/admin/operations` — Restricciones y alertas en tiempo real · lectura A F S · edición A
```json
{ "provinceOnly": { "enabled": true, "locked": true, "label": "Solo trayectos dentro de la provincia" },
  "realtimeAlerts": { "enabled": true, "rules": [
    { "kind": "unusual_cancellations", "label": "Cancelaciones inusuales", "enabled": true,
      "params": { "thresholdCount": 5, "windowMinutes": 60 }, "source": "available", "sourceNote": null },
    { "kind": "schedule_price_changes", "label": "Cambios de horario o precio (requiere aceptación)", "enabled": true,
      "params": { "maxPendingMinutes": 30 }, "source": "available", "sourceNote": null },
    { "kind": "route_incidents", "label": "Incidencias en ruta", "enabled": true,
      "params": { "thresholdCount": 1, "windowMinutes": 60 }, "source": "unavailable",
      "sourceNote": "La fuente de incidencias (módulo live) aún no está disponible." } ] },
  "updatedAt": null, "updatedBy": null }
```
`source` de `route_incidents` es `available` en cuanto existe la tabla `incident_reports` de `be-live` (el ejemplo es el de un entorno sin ella).
`PUT` acepta `{ "realtimeAlertsEnabled"?: bool, "rules"?: [{kind, enabled?, params?}], "provinceOnly"?: true }` y devuelve el mismo documento que `GET`;
`provinceOnly:false` → `422 PROVINCE_ONLY_LOCKED`. Parámetros por regla (enteros): `unusual_cancellations` y `route_incidents` → `thresholdCount` 1–1000 y
`windowMinutes` 5–1440; `schedule_price_changes` → `maxPendingMinutes` 1–1440. Un parámetro no admitido o fuera de rango → `400 VALIDATION_ERROR`
(`details.issues`) sin modificar nada. La edición es atómica y deja `before/after` en la auditoría. Auditoría `admin.operations.viewed` / `admin.operations.updated`.

#### `GET /v1/admin/alerts` — Alertas · A F S · `admin.alerts.listed`
Query `status=open|acknowledged|resolved|all` (por defecto `open`) · `kind` · `cursor` · `limit`. `Page<AdminAlert>`:
```json
{ "items": [ { "id": "b8c9d0e1-f2a3-4b4c-9d5e-f6a7b8c9d017", "kind": "unusual_cancellations", "severity": "warning", "status": "open",
               "title": "Cancelaciones inusuales", "body": "6 reservas canceladas en los últimos 60 minutos (umbral: 5).",
               "detectedAt": "2026-10-09T13:30:00.000Z", "province": null, "data": { "count": 6, "windowMinutes": 60, "thresholdCount": 5 },
               "acknowledgedAt": null, "resolvedAt": null } ], "nextCursor": null }
```
Las alertas se generan **solo a partir de eventos reales** (reservas/viajes cancelados, propuestas de cambio de ruta con impacto de precio/horario
sin responder, incidencias si existe la fuente) con el evaluador; nunca se siembran ni se inventan. `data` contiene solo identificadores y recuentos.
Reglas del evaluador:
- `unusual_cancellations`: por provincia, ≥ `thresholdCount` reservas canceladas (por pasajero o conductor) en los últimos `windowMinutes` → `warning`; con ≥ 2× el
  umbral → `critical`.
- `schedule_price_changes`: por propuesta de cambio de ruta con impacto material en precio u horario que lleva **pendiente** más de `maxPendingMinutes` → `warning`.
  Cuando la propuesta deja de estar pendiente, la alerta se cierra sola (`autoResolved`).
- `route_incidents`: por provincia, ≥ `thresholdCount` incidencias `open`/`in_review` de `incident_reports` (be-live) creadas en los últimos `windowMinutes` → `warning`;
  `critical` si alguna es de seguridad. Sin esa tabla la regla se omite (`skippedReason:"source_unavailable"`).
- Mientras haya una alerta `open`/`acknowledged` con la misma clave de deduplicación (provincia o propuesta), no se crea otra.

#### `POST /v1/admin/alerts/evaluate` — Evaluar reglas ahora · A S · `admin.alerts.evaluated`
Sin cuerpo. `AdminAlertEvaluation`: `{ evaluatedAt, created, autoResolved, rules: [{ kind, enabled, evaluated, created, skippedReason }] }`, con
`skippedReason: "disabled" | "realtime_alerts_off" | "source_unavailable" | null`. Con las «Alertas en tiempo real» desactivadas no se evalúa nada
(`realtime_alerts_off`). Cada alerta **nueva** se inserta y notifica **en la misma transacción** a las personas activas con rol `admin` o `support_admin`
(notificación in‑app `system/admin_alert` con el título de la alerta; sin datos personales): si la notificación falla, la alerta no se crea.
La auditoría `admin.alerts.evaluated` registra `{ via, created, autoResolved, byKind }`.
Disparable también desde línea de comandos (por ejemplo desde un cron; actor `null`, `via:"cli"`): `npx tsx src/modules/trust/operations/run-evaluator.ts`.

#### `POST /v1/admin/alerts/{alertId}/status` — Reconocer / resolver · A S · `admin.alert.status_changed`
`{ "status": "acknowledged" | "resolved" }` → `AdminAlert`. Errores: `404 ALERT_NOT_FOUND` · `409 ALERT_INVALID_TRANSITION`.

#### `GET /v1/admin/audit-events` — Auditoría · A · `admin.audit_log.viewed`
Query: `actorUserId` · `action` (exacta; con `*` final = prefijo, p. ej. `admin.*`) · `entityType` · `entityId` · `from` / `to` (ISO) · `cursor` · `limit`.
```json
{ "items": [ { "id": "10482", "createdAt": "2026-10-09T13:38:12.000Z",
               "actor": { "id": "a1d4f7c2-9e3b-4c58-b2d6-0f1e2d3c4b12", "displayName": "Lucía Ramos" },
               "action": "admin.evidence.access_url_issued", "entityType": "private_document", "entityId": "c4a1f9e0-6b2d-4e57-8c3a-7d1e2f3a4b05",
               "requestId": "req-9", "metadata": { "purpose": "identity_review", "ttlSeconds": 120, "ownerUserId": "3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01", "contact": "[oculto]" },
               "redactions": 1 } ], "nextCursor": "eyJpZCI6IjEwNDgyIn0" }
```
Se ocultan en `metadata` claves personales (teléfono, email, nombre, dirección, IP, tokens, claves/URL de almacenamiento, coordenadas) y valores con
forma de teléfono/email. Errores: `422 AUDIT_FILTER_INVALID` · `400 CURSOR_INVALID`.

#### `GET/POST /v1/admin/legal/documents`, `POST /v1/admin/legal/documents/{documentId}/publish` — Condiciones y políticas · A
- `GET` → `{ "items": LegalDocumentSummary[] }` con **todas** las versiones. 
- `POST` `{ "kind": "terms", "title": "…", "sections": [LegalSection] }` → `201 LegalDocument` en `draft_pending_legal_review` (versión = máx+1). `422 LEGAL_CONTENT_INVALID`.
- `publish` `{ "legalReviewReference": "Revisión legal 2026-11-02", "effectiveFrom"?: ISO }` → `LegalDocument` `published`; la versión publicada anterior pasa a `retired`.
  Errores: `422 LEGAL_REVIEW_REFERENCE_REQUIRED` · `409 LEGAL_ALREADY_PUBLISHED` · `404 LEGAL_DOCUMENT_NOT_FOUND`.
- Auditoría: `admin.legal.listed|created|published`.

### 4.4 Atención al cliente (consultas de soporte) · A S

El personal atiende las consultas que las personas usuarias abren en el centro de ayuda (`be-comms`, [`docs/contracts/comms.md`](comms.md) §9.1). Este módulo
**lee y escribe** `support_tickets`, `support_ticket_messages` y `support_attachments` directamente; los disparadores de la migración 062 mantienen estado y
notificación (responder → la consulta pasa a `answered`, se fija `last_staff_message_at` y la persona usuaria recibe un aviso `support_reply`).
Si esas tablas no existen en el entorno, **todos** estos endpoints responden `503 SUPPORT_UNAVAILABLE` (no se simula una cola vacía).
Cada lectura y cada acción dejan un evento de auditoría con el actor; el texto de los mensajes **no** se copia a la auditoría (solo longitud e identificadores).

#### `GET /v1/admin/support/tickets` — Cola de consultas · `admin.support.tickets_listed`
Query: `status=open|answered|closed|all` (por defecto `open`) · `category=trip_issue|payment_issue|account_profile` · `assigned=any|me|unassigned` (por defecto `any`) ·
`cursor` · `limit`. Orden: la consulta con el mensaje de la persona usuaria más reciente primero. Respuesta `AdminSupportTicketsPage`:
```json
{ "items": [ { "id": "c9d0e1f2-a3b4-4c5d-8e6f-a7b8c9d0e118", "reference": "MVC-2026-000123", "status": "open", "category": "payment_issue",
               "categoryLabel": "Problema de pago",
               "user": { "id": "7b9e2a10-5f33-4d8e-a1c4-2e8d9f4b6c02", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": null },
               "preview": "Me han cobrado dos veces el trayecto Sevilla - Los Bermejales → Cartuja…", "createdAt": "2026-10-09T08:12:00.000Z",
               "lastUserMessageAt": "2026-10-09T08:12:00.000Z", "lastStaffMessageAt": null, "assignedTo": null,
               "messageCount": 1, "attachmentCount": 0, "waitingForStaff": true } ],
  "nextCursor": null, "counts": { "open": 3, "answered": 5, "closed": 12 } }
```
`counts` son totales por estado y **no** dependen de los filtros. Errores: `400 CURSOR_INVALID` · `503 SUPPORT_UNAVAILABLE` · `403` · `401`.

#### `GET /v1/admin/support/tickets/{ticketId}` — Detalle con el hilo · `admin.support.ticket_viewed`
`AdminSupportTicketDetail` = la fila + `tripId`, `bookingId`, `closedAt`, `closedBy` (`user|staff`), `messages[]` (`authorType`, `author`, `body`, `createdAt`,
`attachments[]` — el primer mensaje es la consulta original) y `attachments[]` sueltos. Los adjuntos solo exponen `id`, `contentType`, `sizeBytes`, `createdAt`
(**nunca** claves de almacenamiento). Errores: `404 TICKET_NOT_FOUND` · `503 SUPPORT_UNAVAILABLE`.

#### `POST /v1/admin/support/tickets/{ticketId}/reply` — Responder · `admin.support.ticket_replied`
`{ "body": "…" }` (1–4000 caracteres tras recortar espacios). Inserta el mensaje de personal y la auditoría en **una** transacción con la fila de la consulta bloqueada.
Devuelve el detalle actualizado (`status:"answered"`). Errores: `409 TICKET_CLOSED` · `404 TICKET_NOT_FOUND` · `400 VALIDATION_ERROR` · `503 SUPPORT_UNAVAILABLE`.

#### `POST /v1/admin/support/tickets/{ticketId}/assign` — Asignarme / quitar la asignación · `admin.support.ticket_assigned`
`{ "assignee": "me" | "none" }` (`me` = la persona autenticada; no se puede asignar a otra). Devuelve el detalle. Errores: `404 TICKET_NOT_FOUND` · `503 SUPPORT_UNAVAILABLE`.

#### `POST /v1/admin/support/tickets/{ticketId}/close` — Cerrar · `admin.support.ticket_closed`
Sin cuerpo. Fija `status:"closed"`, `closedBy:"staff"`. Devuelve el detalle. Errores: `409 TICKET_ALREADY_CLOSED` · `404 TICKET_NOT_FOUND` · `503 SUPPORT_UNAVAILABLE`.

#### `POST /v1/admin/support/attachments/{attachmentId}/access` — Ver un adjunto · `admin.support.attachment_access_url_issued`
Cuerpo opcional `{ "note"?: "…" }` (≤500). Misma garantía que las evidencias: se firma la URL (vida `TRUST_SIGNED_URL_TTL_SECONDS`, 120 s por defecto), **se escribe la
auditoría** (quién, qué, propósito `support_case`, TTL, propietario) y solo entonces se devuelve; si la auditoría falla no sale ninguna URL.
```json
{ "url": "https://mvc-private.s3.eu-west-1.amazonaws.com/users/…?X-Amz-Expires=120&X-Amz-Signature=…", "expiresAt": "2026-10-09T13:43:00.000Z",
  "ttlSeconds": 120, "contentType": "image/jpeg", "attachmentId": "d0e1f2a3-b4c5-4d6e-9f7a-b8c9d0e1f219" }
```
Errores: `404 ATTACHMENT_NOT_FOUND` (también si el adjunto no cuelga de una consulta) · `403 SELF_REVIEW_FORBIDDEN` (el adjunto es del propio personal) ·
`409 EVIDENCE_STORAGE_MISMATCH` · `503 PRIVATE_STORAGE_DISABLED` · `503 SUPPORT_UNAVAILABLE`.

**No implementado (ver §6):** moderación de denuncias de usuarios (`user_reports`, comms §9.2) y de mensajes, y suspensión de cuentas desde el panel.

## 5. Configuración (variables de entorno; todas con valor seguro por defecto)

| Variable | Defecto | Efecto |
|---|---|---|
| `ECONOMICS_ACTIVATION` | `disabled` | `enabled` permite publicar tarifas (con `approvalReference` y `effectiveFrom` futuro). Cualquier otro valor (incluido vacío o `true`) ⇒ error de arranque. |
| `TRUST_SIGNED_URL_TTL_SECONDS` | `120` | Vida de la URL firmada de evidencias y adjuntos de soporte para el personal (30–300). |
| `TRUST_OWN_PREVIEW_TTL_SECONDS` | `300` | Vida de las vistas previas firmadas de lo propio (60–900). |
| `TRUST_PUBLIC_PHOTO_TTL_SECONDS` | `900` | Vida de la URL firmada tras el 302 de la foto pública (60–3600). |
| `TRUST_IP_HASH_PEPPER` | *(vacío)* | Clave HMAC para el hash de IP de las aceptaciones; sin ella no se guarda hash. |
| `TRUST_VEHICLE_ACTIVITY_FRESHNESS_SECONDS` | `600` | Antigüedad máxima de una posición para contarla como «en ruta» (60–3600). |
| `PRIVATE_STORAGE_PROVIDER` | `disabled` | (núcleo) Sin `s3`, todo lo que sube o lee archivos privados responde `503 PRIVATE_STORAGE_DISABLED`. |
| `PRIVATE_UPLOAD_TTL_SECONDS` | `600` | (núcleo) Vida de las URL firmadas de subida. |

(No se han podido añadir a `src/config.ts` / `.env.example` por propiedad de archivos: los lee `src/modules/trust/config.ts` con `loadTrustConfig()`; el orquestador debe copiar
las seis `ECONOMICS_*` / `TRUST_*` a `.env.example` con estos valores por defecto.)

## 6. Dependencias, bloqueos y límites (estado honesto)

- **Bloqueado — revisión legal**: términos, privacidad, cancelación y aviso de la comprobación son borradores estructurales (`draft_pending_legal_review`); sin validez legal.
  Publicar una versión exige `legalReviewReference`.
- **Bloqueado — economía**: tarifa/comisiones/Premium/topes sin decisión; importes derivados «Por definir»; publicar tarifas devuelve 409 (`ECONOMICS_ACTIVATION_DISABLED`).
  Ningún endpoint de este módulo activa tarifas, comisiones ni cobros.
- **Bloqueado — política de cancelación versionada**: este módulo no calcula devoluciones; `proposedRefund`, `platformCommission` y `finalPassengerCost` salen de
  `refund_requests` (be-money) cuando existe una propuesta y, si no, «Por definir».
- **Bloqueado — almacenamiento privado**: sin `PRIVATE_STORAGE_PROVIDER=s3` todo lo que sube archivos responde `PRIVATE_STORAGE_DISABLED`.
- **Bloqueado — biometría facial**: no activada (finalidad, base jurídica, proveedor, conservación, eliminación y alternativa pendientes). Ningún código la
  ejecuta: `review:"human"`, `biometricMatching:"not_activated"`.
- **Dependencia `be-live`**: la fuente de «Incidencias» (resumen) y de la regla «Incidencias en ruta» es la tabla `incident_reports` si existe; si no, `available:false` /
  `source_unavailable`. La actividad de vehículos se agrega del estado en directo de los viajes activos (`trip_live_state`; aproximada, celdas de ~2 km, sin identidades).
- **Dependencia `be-money`**: devoluciones propuestas/ejecutadas (`refund_requests`); las acciones de devolución son suyas.
- **Dependencia `be-comms`**: consultas de soporte (§4.4: tablas de la migración 062) y derechos sobre los datos (§8). Sin esas tablas: `503 SUPPORT_UNAVAILABLE`.
- **No implementado**:
  - borrado físico de selfies/documentos por plazo y política de retención (la interfaz `PrivateObjectStorage` no tiene `deleteObject`; plazo «por definir»);
    las imágenes solo se eliminan en la baja de cuenta por el paso de comms;
  - invalidación automática de la comprobación al cambiar la foto pública; MFA/«doble control» para el personal; moderación de foto por IA;
  - moderación de denuncias de usuarios (`user_reports`), retirada de mensajes y suspensión de cuentas desde el panel (comms §9.2): no pedido en las pantallas 37–40;
  - filtro por provincia en la cola «Usuarios y revisión» (el modelo no asocia usuarios a provincias);
  - imágenes y notas internas del personal en la exportación de datos del usuario (criterio legal pendiente).
- La **vista previa del navegador** emite `illustrative` y personajes de diseño (Ana/Miguel); el backend real nunca lo hace salvo `tariffs/example`.
- **Defecto conocido del núcleo (no es de este módulo)**: `resolveSession` (`src/auth/session.ts:63`) y `GET /v1/me` (`src/routes/me-routes.ts:17`) usan
  `array_agg(ur.role)` sobre un tipo enumerado: `pg` lo entrega como TEXTO (`"{driver,passenger}"`), no como array. Este módulo lo absorbe con `normalizeRoles()` (`rbac.ts`);
  la corrección de una línea es `array_agg(ur.role::text)`.

## 7. Cómo se prueba

```bash
export DATABASE_URL=postgres://mvc:mvc_local_test@127.0.0.1:5432/mvc_trust
MIGRATIONS_EXCLUDE="020-079" npm run db:migrate          # solo núcleo + migraciones 080-099 de trust
node --import tsx --test --test-concurrency=1 tests/trust-*.integration.test.ts
node --import tsx --test tests/unit/trust-*.test.ts
npm run typecheck
```
Las pruebas de integración usan la base privada `mvc_trust` (la vacían y siembran en cada prueba; el arnés **rechaza** cualquier base de datos que no se llame `mvc_trust` o `mvc_trust_full`). Las que
dependen de tablas de otros módulos (`incident_reports`, `refund_requests`, `support_*`, `route_change_proposals`) se **omiten** (`skip`) si no existen. Para
ejecutarlas completas hace falta una base con **todas** las migraciones (en este entorno de desarrollo existe `mvc_trust_full`, migraciones 001–083, que se crea y migra igual):
```bash
export DATABASE_URL=postgres://mvc:mvc_local_test@127.0.0.1:5432/mvc_trust_full
npm run db:migrate
node --import tsx --test --test-concurrency=1 tests/trust-*.integration.test.ts
```
CLI de roles de personal (sin contraseña maestra; requiere acceso a la base de datos): `npx tsx scripts/grant-role.ts grant +34600111222 verification_admin`
(también `revoke` y `list`; `--dry-run` simula sin escribir; no retira al último `admin` activo salvo `--force`). Evaluador de alertas: `npx tsx src/modules/trust/operations/run-evaluator.ts`.

## 8. Derechos sobre los datos (RGPD)

`registerTrustModule()` conecta el módulo con el registro de `comms` (`src/modules/comms/registry.ts`; si no está disponible, avisa en el log y sigue):
- **Exportación** (`modules.trust` en `buildUserDataExport`): estados y fechas de fotos de perfil y de la comprobación privada (intentos y versión del aviso aceptada),
  aceptaciones legales (tipo, versión, contexto, fecha, si hay hash de IP — nunca su valor) y nº de subidas pedidas. **No** incluye imágenes ni notas internas del personal
  (se indica en `notes`).
- **Eliminación de cuenta**: borra intentos de selfie, comprobación, fotos de perfil e intenciones de subida (devuelve sus claves de almacenamiento a comms para borrar los
  objetos **antes** de anonimizar) y anula el hash de IP de las aceptaciones legales, que **se conservan** como prueba del consentimiento (plazo «por definir», validación
  jurídica pendiente). Los documentos de `private_documents` y las claves de `profiles` los borra el paso de cuenta de comms.
