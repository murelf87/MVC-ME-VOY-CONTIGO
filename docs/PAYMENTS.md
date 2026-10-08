# Pagos, contabilidad y pagos a conductores

Sección 9 del prompt maestro. El núcleo no depende del proveedor: MVC nunca custodia dinero, el libro contable solo refleja lo que el proveedor regulado confirma.

## Estado
- **Implementado y probado**: libro de doble entrada en céntimos, bandeja de webhooks con deduplicación, eventos fuera de orden, reembolsos según la política aceptada, disputas, conciliación, saldos pendientes y disponibles, preparación de pagos mensuales y verificación de firma de Stripe.
- **Bloqueado**: no hay proveedor contratado ni claves. Con `PAYMENTS_PROVIDER=disabled` (por defecto) el webhook responde 503 y nada se cobra ni se paga. La creación del cobro en la app (PaymentIntent / Checkout) y la orden de transferencia a cada conductor (Connect) necesitan la cuenta del proveedor.
- **Decisiones pendientes**: proveedor definitivo (el adaptador de Stripe es el primero porque Connect sirve para marketplace y pagos a terceros), quién asume una disputa perdida (hoy se apunta como pérdida de MVC), qué pasa con el dinero de un pasajero que no se presenta (queda pendiente hasta que la política lo diga) y si el cobro al pasajero será semanal.

## Libro contable
`ledger_transactions` + `ledger_entries`. Cargo positivo, abono negativo; la base de datos rechaza al confirmar cualquier transacción que no sume cero (`MVC_LEDGER_UNBALANCED`) y cualquier edición o borrado (`MVC_LEDGER_IMMUTABLE`). Cada asiento tiene una clave de idempotencia (`booking:<id>:capture`, `payout:<id>:paid`…).

| Momento | Asiento |
|---|---|
| Cobro confirmado | proveedor +total, conductor pendiente −neto, MVC −(comisión pasajero + comisión conductor) |
| Viaje finalizado con el pasajero a bordo | conductor pendiente → disponible |
| Reembolso confirmado | proveedor −reembolso; vuelve del conductor la parte de aportación menos la comisión que llevaba, y de MVC la tarifa y esa comisión (redondeo a la mitad hacia arriba). Lo que la política deja al conductor pasa a disponible |
| Pago mensual preparado | conductor disponible → en tránsito |
| Pago confirmado / fallido | en tránsito → sale del proveedor / vuelve a disponible |
| Disputa perdida | proveedor −importe, pérdidas por disputas +importe |

## Webhooks
`POST /v1/payments/webhooks/stripe`: firma `Stripe-Signature` sobre el cuerpo exacto (HMAC-SHA256, tolerancia 300 s, varias firmas durante la rotación de secreto). Cada evento se guarda una vez (`payment_provider_events`, único por proveedor + id). Si depende de algo que aún no existe (un reembolso antes de la cancelación, un pago antes de prepararlo) queda `deferred` y `npm run payments:retry` lo reintenta en el orden en que ocurrió. Un importe distinto del acordado queda `failed` con el motivo y no reserva nada. Una disputa solo avanza con eventos más nuevos.

## Pagos a conductores
`POST /v1/admin/payouts/prepare {month:"YYYY-MM"}` (admin o finanzas), solo para meses cerrados y una vez por conductor y mes. Quedan `pending_provider` hasta que el proveedor confirme con `payout.paid` o `payout.failed`.

## Consultas
- `GET /v1/me/earnings`: pendiente, disponible, en tránsito y últimos pagos del conductor.
- `GET /v1/admin/payments`: eventos por estado, problemas, saldos por cuenta, si el libro cuadra, conciliación (`provider_clearing` frente a cobros − reembolsos − pagos − disputas perdidas), disputas y pagos.

## Configuración
`PAYMENTS_PROVIDER=stripe` y `STRIPE_WEBHOOK_SECRET` (nunca en el repositorio).
