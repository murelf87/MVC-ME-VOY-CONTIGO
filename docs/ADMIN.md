# Panel de administración

El panel está dentro de la app (Perfil › Panel de administración) y solo aparece a cuentas con un rol de staff. Todas las acciones pasan por `/v1/admin/*`, comprueban el rol en el servidor y quedan en `audit_events`.

| Rol | Puede |
| --- | --- |
| `admin` | Todo, incluida la auditoría, suspender o reactivar cuentas y conceder o retirar roles de staff |
| `verification_admin` | Cola de verificación: identidad, vehículos y documentos; buscar usuarios |
| `support_admin` | Incidencias, viajes y búsqueda de usuarios |
| `finance_admin` | Reembolsos pendientes y políticas de cancelación |

Reglas:
- No hay contraseña maestra. El primer `admin` lo da alguien con acceso a la base de datos: `npm run staff:grant -- +34600000000 admin` (la persona debe haber entrado antes una vez con su móvil). Queda auditado como `operator_cli`. Los siguientes roles se conceden desde el panel.
- Nadie puede revisar su propio perfil, suspenderse ni quitarse su propio rol `admin`.
- Suspender una cuenta revoca todas sus sesiones al momento.
- Los teléfonos se muestran enmascarados en las listas.
- Ver documentos privados exige el almacenamiento privado (**bloqueado** hasta configurar proveedor).
