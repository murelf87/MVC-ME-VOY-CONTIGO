import type { PoolClient, Pool } from "pg";

export type NotificationCategory = "trip" | "message" | "payment" | "system";

export type NotificationInput = {
  userId: string;
  category: NotificationCategory;
  /** Identificador estable del tipo de aviso, p. ej. "pickup_soon", "request_accepted", "payment_completed". */
  kind: string;
  title: string;
  body: string;
  /** Datos para navegar desde el aviso (tripId, bookingId, conversationId...). Nunca datos sensibles. */
  data?: Record<string, unknown>;
};

type Queryable = Pick<PoolClient, "query"> | Pick<Pool, "query">;

/** Inserta una notificación in-app dentro de la transacción del llamante. El envío push lo gestiona `comms`. */
export async function notify(db: Queryable, input: NotificationInput): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into notifications(user_id,category,kind,title,body,data)
     values($1,$2,$3,$4,$5,$6::jsonb)
     returning id`,
    [input.userId, input.category, input.kind, input.title, input.body, JSON.stringify(input.data ?? {})]
  );
  return result.rows[0]!.id;
}
