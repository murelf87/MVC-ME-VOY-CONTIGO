# Panel de administración

El panel está dentro de la app (Perfil › Panel de administración) y solo aparece a cuentas con un rol de staff. Todas las acciones pasan por `/v1/admin/*`, comprueban el rol en el servidor y quedan en `audit_events`.

| Rol | Puede |
| --- | --- |
| `admin` | Todo, incluida la auditoría, suspender o reactivar cuentas y conceder o retirar roles de staff |
| `verification_admin` | Cola de verificación: identidad, vehículos y documentos; buscar usuarios |
| `support_admin` | Incidencias, viajes y búsqueda de usuarios |
| `finance_admin` | Reembolsos pendientes y políticas de cancelación |

Reglas:
- No hay contraseña maestra. El primer `admin` lo da alguien con acceso a la base de datos: `npm run staff:grant -- correo@ejemplo.es admin` (la persona debe haberse registrado antes). Queda auditado como `operator_cli`. Los siguientes roles se conceden desde el panel.
- Nadie puede revisar su propio perfil, suspenderse ni quitarse su propio rol `admin`.
- Suspender una cuenta revoca todas sus sesiones al momento.
- Los correos se muestran enmascarados en las listas.
- Ver documentos privados exige el almacenamiento privado (**bloqueado** hasta configurar proveedor).

## Condiciones de uso y privacidad
- Pestaña **Condiciones** (solo `admin`): se guarda un borrador con título y texto, y se publica cuando está aprobado. Cada tipo (`terms`, `privacy`) tiene sus versiones numeradas; publicar una retira la anterior.
- El texto publicado no se puede modificar (lo impide la base de datos): es la prueba de lo que aceptó cada persona. Para cambiarlo se publica otra versión.
- Tras publicar, la app pide aceptar antes de seguir, y el servidor rechaza reservar, pedir un desvío, reservar una semana o publicar un viaje con `LEGAL_ACCEPTANCE_REQUIRED` hasta que se acepte.
- Cada aceptación guarda usuario, versión y hora (`legal_acceptances`). Mientras no haya nada publicado no se bloquea nada.
- Endpoints: `GET /v1/legal/current` (público), `GET /v1/me/legal`, `POST /v1/me/legal/accept`, `GET|POST /v1/admin/legal-documents`, `POST /v1/admin/legal-documents/:id/publish`.
- MVC no incluye textos legales propios: el contenido lo aporta vuestro asesor (ver BLOCKERS 12).
