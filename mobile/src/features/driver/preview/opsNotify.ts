/**
 * Avisos del paquete `driver-ops` en el backend en memoria de la vista previa (SIMULACIÓN, solo con `EXPO_PUBLIC_PREVIEW=1`).
 *
 * El backend real avisa con `notify()` dentro de la transacción de cada servicio. Aquí los servicios de dominio emiten
 * eventos síncronos y este fichero los convierte en filas de `comms_notifications` (la tabla del módulo `comms`, que
 * declara y lee el paquete `messages`): misma forma de fila, aviso ESENCIAL (nunca se silencia) y categoría `trip`.
 */
import type { NotificationCategory } from "@/api/types";
import { ROUTE_CHANGE_NOTICE_EVENT, type Collection, type PreviewDb, type RouteChangeNotice } from "@/preview";

/** Misma forma que `NotificationRow` de `features/messages/preview/rows.ts` (tabla `comms_notifications`). */
interface NoticeRow {
  id: string;
  user_id: string;
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  essential: boolean;
  read_at: number | null;
  created_at: number;
  delivery_state: "delivered" | "suppressed";
}

const notices = (db: PreviewDb): Collection<NoticeRow> => db.collection<NoticeRow>("comms_notifications");

export interface OpsNoticeInput {
  userId: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  category?: NotificationCategory;
}

/** Crea un aviso esencial para `userId` (el equivalente de `notify()` del backend). */
export function pushOpsNotice(db: PreviewDb, input: OpsNoticeInput): void {
  notices(db).insert({
    id: db.ids.uuid(),
    user_id: input.userId,
    category: input.category ?? "trip",
    kind: input.kind,
    title: input.title,
    body: input.body,
    data: input.data,
    essential: true,
    read_at: null,
    created_at: db.nowMs(),
    delivery_state: "delivered",
  });
}

/** Suscribe los avisos de cambio de ruta (`route_change.notice`) a `comms_notifications`. Se llama una vez por base de datos. */
export function wireRouteChangeNotices(db: PreviewDb): void {
  db.events.on(ROUTE_CHANGE_NOTICE_EVENT, (payload) => {
    const notice = payload as RouteChangeNotice;
    pushOpsNotice(db, {
      userId: notice.userId,
      kind: notice.kind,
      title: notice.title,
      body: notice.body,
      data: { ...notice.data },
    });
  });
}
