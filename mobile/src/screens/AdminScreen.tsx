import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../api/client";
import { formatDeparture, tripStatusLabel } from "../api/trips";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

export const STAFF_ROLES = ["admin", "verification_admin", "finance_admin", "support_admin"];
export function isStaff(roles: readonly string[]): boolean {
  return roles.some(role => STAFF_ROLES.includes(role));
}

type Tab = "summary" | "verification" | "reports" | "finance" | "users" | "trips" | "legal" | "audit";

const TAB_RULES: Array<{ id: Tab; label: string; roles: string[] }> = [
  { id: "summary", label: "Resumen", roles: STAFF_ROLES },
  { id: "verification", label: "Verificación", roles: ["admin", "verification_admin"] },
  { id: "reports", label: "Incidencias", roles: ["admin", "support_admin"] },
  { id: "trips", label: "Viajes", roles: ["admin", "support_admin"] },
  { id: "finance", label: "Finanzas", roles: ["admin", "finance_admin"] },
  { id: "users", label: "Usuarios", roles: ["admin", "support_admin", "verification_admin"] },
  { id: "legal", label: "Condiciones", roles: ["admin"] },
  { id: "audit", label: "Auditoría", roles: ["admin"] },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "Administración",
  verification_admin: "Verificación",
  finance_admin: "Finanzas",
  support_admin: "Soporte",
  driver: "Conductor",
  passenger: "Pasajero",
};

const REPORT_LABEL: Record<string, string> = {
  safety: "Seguridad", behaviour: "Comportamiento", no_show: "No se presentó", vehicle: "Vehículo",
  route: "Ruta u horario", payment: "Pago", other: "Otro",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado", verified: "Verificada", unverified: "Sin verificar",
  open: "Abierta", reviewing: "En revisión", resolved: "Resuelta", dismissed: "Descartada",
  pending_policy: "Sin política", pending_provider: "Pendiente de pago", active: "Activa", suspended: "Suspendida",
  draft: "Borrador", retired: "Retirada",
};

const AUDIT_LABEL: Record<string, string> = {
  "user.deleted": "Cuenta eliminada", "auth.registered": "Cuenta creada", "auth.email_verified": "Correo confirmado", "auth.password_reset": "Contraseña recuperada", "auth.password_changed": "Contraseña cambiada", "legal_document.created": "Condiciones redactadas", "legal_document.published": "Condiciones publicadas",
  "ride_request.created": "Solicitud de plaza", "ride_request.rejected": "Solicitud rechazada",
  "ride_request.accepted_with_hold": "Solicitud aceptada", "ride_request.cancelled": "Solicitud cancelada",
  "booking.confirmed": "Reserva confirmada", "trip.started": "Viaje iniciado", "trip.completed": "Viaje finalizado",
  "trip.cancelled": "Viaje cancelado", "vehicle.created": "Vehículo registrado", "vehicle.reviewed": "Vehículo revisado",
  "profile.reviewed": "Perfil revisado", "incident_report.created": "Incidencia creada",
  "incident_report.status_changed": "Incidencia actualizada", "user.suspended": "Cuenta suspendida",
  "user.reactivated": "Cuenta reactivada", "role.granted": "Rol concedido", "role.revoked": "Rol retirado",
  "cancellation_policy.created": "Política creada", "cancellation_policy.activated": "Política activada",
  "tariff.created": "Tarifa creada", "tariff.approved": "Tarifa aprobada",
};

const INTEGRATION_LABEL: Record<string, string> = {
  sms: "SMS de verificación", maps: "Mapas y rutas", storage: "Fotos y documentos privados",
  insuranceOcr: "Lectura de seguros", payments: "Cobros y pagos", push: "Notificaciones push",
};

function msg(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : "Algo ha fallado.";
}
function euros(cents: number | null | undefined): string {
  return cents == null ? "—" : (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function previousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function previousMonthLabel(): string {
  return new Date(`${previousMonth()}-15T12:00:00`).toLocaleDateString("es-ES", { month: "long" });
}
function when(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AdminScreen() {
  const { token, roles } = useAuth();
  const mine = roles as readonly string[];
  const tabs = TAB_RULES.filter(t => t.roles.some(r => mine.includes(r)));
  const [tab, setTab] = useState<Tab>("summary");
  const [loaded, setLoaded] = useState<{ tab: Tab; data: any } | null>(null);
  // Only show data that belongs to the visible tab, so a tab switch never renders stale shapes.
  const data = loaded?.tab === tab ? loaded.data : null;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const path: Record<Tab, string> = {
        summary: "/v1/admin/overview",
        verification: "/v1/admin/verification-queue",
        reports: "/v1/admin/reports",
        trips: "/v1/admin/trips",
        finance: "/v1/admin/refunds/pending",
        users: `/v1/admin/users?q=${encodeURIComponent(query)}`,
        legal: "/v1/admin/legal-documents",
        audit: "/v1/admin/audit?limit=60",
      };
      const result: any = await apiRequest(path[tab], { token });
      if (tab === "finance") {
        result.policies = (await apiRequest<any>("/v1/admin/cancellation-policies", { token })).policies;
        result.tariffs = (await apiRequest<any>("/v1/admin/tariffs", { token })).tariffs;
        result.payments = await apiRequest<any>("/v1/admin/payments", { token });
      }
      setLoaded({ tab, data: result });
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }, [token, tab, query]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function act(path: string, body: unknown, done: string) {
    if (!token) return;
    setError("");
    try {
      await apiRequest(path, { method: "POST", token, body });
      setNotice(done);
      await load();
    } catch (e) {
      setError(msg(e));
    }
  }

  const note = (id: string) => (notes[id] ?? "").trim();
  const num = (id: string) => Number((notes[id] ?? "").replace(",", ".").trim());
  function createTariff() {
    const rate = num("t:rate"), pax = num("t:pax"), drv = num("t:drv"), capText = (notes["t:cap"] ?? "").trim();
    if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(pax) || !Number.isFinite(drv) || (notes["t:rate"] ?? "").trim() === "") {
      setError("Revisa los importes: €/km y porcentajes en números.");
      return;
    }
    void act("/v1/admin/tariffs", {
      rateMicrosPerKm: Math.round(rate * 1_000_000),
      passengerCommissionBps: Math.round(pax * 100),
      driverCommissionBps: Math.round(drv * 100),
      sharedCostCapCents: capText ? Math.round(num("t:cap") * 100) : null,
      notes: note("t:notes") || null,
    }, "Tarifa creada como borrador. Apruébala para que se aplique.");
  }
  const noteInput = (id: string, placeholder: string) => (
    <TextInput
      value={notes[id] ?? ""}
      onChangeText={v => setNotes(c => ({ ...c, [id]: v }))}
      placeholder={placeholder}
      style={s.input}
      maxLength={1000}
    />
  );

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Administración</Text>
      <Text style={s.subtitle}>
        Tus permisos: {mine.filter(r => STAFF_ROLES.includes(r)).map(r => ROLE_LABEL[r]).join(", ")}. Cada acción queda en la auditoría.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
        {tabs.map(t => (
          <Pressable key={t.id} onPress={() => { setNotice(""); setTab(t.id); }} style={[s.tab, tab === t.id && s.tabOn]}>
            <Text style={[s.tabText, tab === t.id && s.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {notice ? <Text style={s.ok}>{notice}</Text> : null}
      {busy && !data ? <ActivityIndicator color={C.blue} style={{ marginTop: 24 }} /> : null}

      {tab === "summary" && data ? (
        <View style={s.grid}>
          {data.verification ? (
            <>
              <Stat icon="car-outline" label="Vehículos por revisar" value={data.verification.pendingVehicles} onPress={() => setTab("verification")} />
              <Stat icon="id-card-outline" label="Identidades y fotos" value={data.verification.pendingProfiles} onPress={() => setTab("verification")} />
              <Stat icon="document-lock-outline" label="Documentos privados" value={data.verification.pendingDocuments} onPress={() => setTab("verification")} />
            </>
          ) : null}
          {data.support ? (
            <>
              <Stat icon="flag-outline" label="Incidencias abiertas" value={data.support.openReports} tone="#C93A3A" onPress={() => setTab("reports")} />
              <Stat icon="navigate-outline" label="Viajes en marcha" value={data.support.activeTrips} onPress={() => setTab("trips")} />
              <Stat icon="calendar-outline" label="Viajes publicados" value={data.support.publishedTrips} onPress={() => setTab("trips")} />
              <Stat icon="people-outline" label="Usuarios activos" value={data.support.activeUsers} onPress={() => setTab("users")} />
            </>
          ) : null}
          {data.finance ? (
            <>
              <Stat icon="return-down-back-outline" label="Reembolsos pendientes" value={data.finance.pendingRefunds} tone="#966112" onPress={() => setTab("finance")} />
              <Stat icon="alert-circle-outline" label="Pagos tardíos a revisar" value={data.finance.pendingCompensations} onPress={() => setTab("finance")} />
              <Stat icon="pricetag-outline" label="Tarifa aplicada" value={data.finance.approvedTariffVersion ? `v${data.finance.approvedTariffVersion}` : "Ninguna"} onPress={() => setTab("finance")} />
              <Stat icon="document-text-outline" label="Política de cancelación" value={data.finance.activePolicyVersion ? `v${data.finance.activePolicyVersion}` : "Ninguna"} onPress={() => setTab("finance")} />
            </>
          ) : null}
        </View>
      ) : null}
      {tab === "summary" && data?.integrations ? (
        <>
          <Text style={s.section}>Integraciones</Text>
          {Object.entries(INTEGRATION_LABEL).map(([key, label]) => {
            const value = data.integrations[key] as string;
            const on = value && value !== "disabled";
            return (
              <View key={key} style={[s.card, s.rowBetween]}>
                <Text style={s.cardTitle}>{label}</Text>
                <Text style={[s.pill, !on && s.pillOff]}>{on ? (value.startsWith("dev_") ? "Solo desarrollo" : value) : "Sin conectar"}</Text>
              </View>
            );
          })}
        </>
      ) : null}

      {tab === "verification" && data ? (
        <>
          <Text style={s.section}>Identidad y foto</Text>
          {!data.profiles.length ? <Text style={s.empty}>Nada pendiente.</Text> : null}
          {data.profiles.map((p: any) => (
            <View key={p.user_id} style={s.card}>
              <Text style={s.cardTitle}>{p.display_name || "Sin nombre"} · {p.email}</Text>
              <Text style={s.meta}>Foto: {STATUS_LABEL[p.public_photo_status]} · Identidad: {STATUS_LABEL[p.identity_status]}</Text>
              {noteInput(`p:${p.user_id}`, "Motivo si rechazas")}
              <View style={s.row}>
                <Btn label="Aprobar identidad" onPress={() => act(`/v1/admin/users/${p.user_id}/profile-review`, { area: "identity", decision: "approved" }, "Identidad aprobada.")} />
                <Btn label="Rechazar" danger onPress={() => act(`/v1/admin/users/${p.user_id}/profile-review`, { area: "identity", decision: "rejected", reason: note(`p:${p.user_id}`) }, "Identidad rechazada.")} />
              </View>
            </View>
          ))}
          <Text style={s.section}>Vehículos</Text>
          {!data.vehicles.length ? <Text style={s.empty}>Nada pendiente.</Text> : null}
          {data.vehicles.map((v: any) => (
            <View key={v.id} style={s.card}>
              <Text style={s.cardTitle}>{v.make} {v.model} · {v.plate}</Text>
              <Text style={s.meta}>{v.driver_display_name || "Conductor"} · {v.passenger_seats} plazas</Text>
              <Text style={s.meta}>
                Coche: {STATUS_LABEL[v.review_status]} · Papeles: {STATUS_LABEL[v.documentation_status]} · Foto: {STATUS_LABEL[v.vehicle_photo_status]} · Seguro: {STATUS_LABEL[v.insurance_status]}
              </Text>
              {noteInput(`v:${v.id}`, "Motivo si rechazas")}
              <View style={s.row}>
                <Btn label="Aprobar coche" onPress={() => act(`/v1/admin/vehicles/${v.id}/review`, { area: "vehicle", decision: "approved" }, "Vehículo aprobado.")} />
                <Btn label="Aprobar papeles" onPress={() => act(`/v1/admin/vehicles/${v.id}/review`, { area: "documentation", decision: "approved" }, "Documentación aprobada.")} />
                <Btn label="Rechazar" danger onPress={() => act(`/v1/admin/vehicles/${v.id}/review`, { area: "vehicle", decision: "rejected", reason: note(`v:${v.id}`) || undefined }, "Vehículo rechazado.")} />
              </View>
            </View>
          ))}
          <Text style={s.section}>Documentos privados</Text>
          <Text style={s.empty}>
            {data.documents.length ? `${data.documents.length} pendientes.` : "Nada pendiente."} Para verlos hace falta el almacenamiento privado, que aún no está configurado.
          </Text>
        </>
      ) : null}

      {tab === "reports" && data ? (
        <>
          {!data.reports.length ? <Text style={s.empty}>No hay incidencias.</Text> : null}
          {data.reports.map((r: any) => {
            const open = r.status === "open" || r.status === "reviewing";
            return (
              <View key={r.id} style={s.card}>
                <View style={s.rowBetween}>
                  <Text style={s.cardTitle}>{REPORT_LABEL[r.category] ?? r.category}</Text>
                  <Text style={[s.pill, !open && s.pillDone]}>{STATUS_LABEL[r.status]}</Text>
                </View>
                <Text style={s.meta}>
                  {r.reporter_display_name || "Usuario"} → {r.reported_display_name || "sin persona"} · {when(r.created_at)}
                </Text>
                <Text style={s.body}>{r.description}</Text>
                {r.resolution_note ? <Text style={s.meta}>Nota: {r.resolution_note}</Text> : null}
                {open ? (
                  <>
                    {noteInput(`r:${r.id}`, "Nota de cierre (obligatoria para cerrar)")}
                    <View style={s.row}>
                      {r.status === "open" ? <Btn label="En revisión" onPress={() => act(`/v1/admin/reports/${r.id}/status`, { status: "reviewing" }, "Marcada en revisión.")} /> : null}
                      <Btn label="Resolver" onPress={() => act(`/v1/admin/reports/${r.id}/status`, { status: "resolved", note: note(`r:${r.id}`) }, "Incidencia resuelta. Avisamos a quien la reportó.")} />
                      <Btn label="Descartar" danger onPress={() => act(`/v1/admin/reports/${r.id}/status`, { status: "dismissed", note: note(`r:${r.id}`) }, "Incidencia descartada.")} />
                    </View>
                  </>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}

      {tab === "trips" && data ? (
        <>
          {!data.trips.length ? <Text style={s.empty}>No hay viajes.</Text> : null}
          {data.trips.map((t: any) => (
            <View key={t.id} style={s.card}>
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>{formatDeparture(t.departure_at)}</Text>
                <Text style={s.pill}>{tripStatusLabel(t.status)}</Text>
              </View>
              <Text style={s.meta}>
                {t.driver_display_name || "Conductor"} · {t.province_name || "Provincia"} · {t.bookings}/{t.offered_seats} plazas reservadas · {t.requests} solicitudes
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {tab === "finance" && data ? (
        <>
          {data.payments ? (
            <>
              <Text style={s.section}>Cobros y pagos</Text>
              {!data.payments.providerConfigured ? (
                <Text style={s.warnBox}>Proveedor de pagos sin conectar: no se cobra ni se paga dinero real. Los webhooks responden "no disponible".</Text>
              ) : null}
              <View style={s.card}>
                <View style={s.rowBetween}>
                  <Text style={s.cardTitle}>Libro contable</Text>
                  <Text style={s.pill}>{data.payments.ledgerBalanced ? "Cuadra" : "NO cuadra"}</Text>
                </View>
                <Text style={s.meta}>
                  En el proveedor: {euros(data.payments.reconciliation.providerClearingCents)} · esperado {euros(data.payments.reconciliation.expectedCents)} · {data.payments.reconciliation.matches ? "conciliado" : "revisar diferencia"}
                  {data.payments.reconciliation.bookingsWithoutCapture ? ` · ${data.payments.reconciliation.bookingsWithoutCapture} reservas sin asiento` : ""}
                </Text>
              </View>
              {data.payments.problems.map((ev: any) => (
                <View key={ev.id} style={s.card}>
                  <View style={s.rowBetween}>
                    <Text style={s.cardTitle}>{ev.event_type}</Text>
                    <Text style={s.pill}>{ev.status === "deferred" ? "En espera" : "Error"}</Text>
                  </View>
                  <Text style={s.meta}>{ev.last_error || "Sin detalle"} · {ev.attempts} intentos · {when(ev.occurred_at)}</Text>
                </View>
              ))}
              {data.payments.disputes.filter((d: any) => d.status === "open").map((d: any) => (
                <View key={d.id} style={s.card}>
                  <Text style={s.cardTitle}>Disputa abierta · {euros(d.amount_cents)}</Text>
                  <Text style={s.meta}>{d.reason || "Sin motivo"} · {d.opened_at ? when(d.opened_at) : ""}</Text>
                </View>
              ))}
              <View style={s.rowBetween}>
                <Text style={s.subsection}>Pagos a conductores (mensual)</Text>
                <Btn label={`Preparar ${previousMonthLabel()}`} onPress={() => act("/v1/admin/payouts/prepare", { month: previousMonth() }, "Pagos preparados. Se envían cuando el proveedor los confirme.")} />
              </View>
              {!data.payments.payouts.length ? <Text style={s.empty}>Aún no hay pagos preparados.</Text> : null}
              {data.payments.payouts.map((p: any) => (
                <View key={p.id} style={s.card}>
                  <View style={s.rowBetween}>
                    <Text style={s.cardTitle}>{p.driver_display_name || "Conductor"} · {euros(p.amount_cents)}</Text>
                    <Text style={s.pill}>{p.status === "paid" ? "Pagado" : p.status === "failed" ? "Fallido" : "Esperando al proveedor"}</Text>
                  </View>
                  <Text style={s.meta}>{p.period_month.slice(0, 7)}{p.failure_reason ? ` · ${p.failure_reason}` : ""}</Text>
                </View>
              ))}
            </>
          ) : null}
          <Text style={s.section}>Reembolsos pendientes</Text>
          {!data.refunds.length ? <Text style={s.empty}>No hay reembolsos pendientes.</Text> : null}
          {data.refunds.map((r: any) => (
            <View key={r.id} style={s.card}>
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>{euros(r.refund_cents)} de {euros(r.paid_cents)}</Text>
                <Text style={s.pill}>{STATUS_LABEL[r.refund_status]}</Text>
              </View>
              <Text style={s.meta}>
                Cancela: {r.actor === "passenger" ? "pasajero" : r.actor === "driver" ? "conductor" : r.actor === "force_majeure" ? "fuerza mayor" : "plataforma"}
                {r.policy_version ? ` · política v${r.policy_version} (${r.rule_applied})` : " · sin política aceptada"} · {when(r.created_at)}
              </Text>
            </View>
          ))}
          <Text style={s.hint}>Los reembolsos se ejecutarán cuando haya proveedor de pagos. Hasta entonces quedan aquí, calculados y sin cobrar ni devolver nada.</Text>
          <Text style={s.section}>Tarifas</Text>
          {(data.tariffs ?? []).map((t: any) => (
            <View key={t.id} style={s.card}>
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>Versión {t.version}</Text>
                <Text style={[s.pill, t.status !== "approved" && s.pillDone]}>{t.status === "approved" ? "Aprobada" : STATUS_LABEL[t.status] ?? t.status}</Text>
              </View>
              <Text style={s.meta}>
                {(t.rate_micros_per_km / 1_000_000).toLocaleString("es-ES", { maximumFractionDigits: 4 })} €/km · pasajero {t.passenger_commission_bps / 100} % · conductor {t.driver_commission_bps / 100} %
                {t.shared_cost_cap_cents != null ? ` · tope ${euros(t.shared_cost_cap_cents)}` : ""}
              </Text>
              {t.notes ? <Text style={s.meta}>{t.notes}</Text> : null}
              {t.status === "draft" ? <Btn label="Aprobar y aplicar" onPress={() => act(`/v1/admin/tariffs/${t.id}/approve`, {}, `Tarifa v${t.version} aprobada. Los presupuestos nuevos ya la usan.`)} /> : null}
            </View>
          ))}
          <View style={s.card}>
            <Text style={s.cardTitle}>Nueva tarifa (borrador)</Text>
            <Text style={s.meta}>Ninguna cifra está decidida en la app: introdúcelas cuando estén aprobadas. Las reservas ya aceptadas conservan su precio.</Text>
            <View style={s.row}>
              <TextInput value={notes["t:rate"] ?? ""} onChangeText={v => setNotes(c => ({ ...c, "t:rate": v }))} placeholder="€/km" keyboardType="decimal-pad" style={[s.input, s.small]} />
              <TextInput value={notes["t:pax"] ?? ""} onChangeText={v => setNotes(c => ({ ...c, "t:pax": v }))} placeholder="% pasajero" keyboardType="decimal-pad" style={[s.input, s.small]} />
              <TextInput value={notes["t:drv"] ?? ""} onChangeText={v => setNotes(c => ({ ...c, "t:drv": v }))} placeholder="% conductor" keyboardType="decimal-pad" style={[s.input, s.small]} />
              <TextInput value={notes["t:cap"] ?? ""} onChangeText={v => setNotes(c => ({ ...c, "t:cap": v }))} placeholder="Tope € (opcional)" keyboardType="decimal-pad" style={[s.input, s.small]} />
            </View>
            {noteInput("t:notes", "Nota (quién la aprobó, por qué)")}
            <Btn label="Crear borrador" onPress={createTariff} />
          </View>
          <Text style={s.section}>Políticas de cancelación</Text>
          {!data.policies?.length ? <Text style={s.empty}>No hay ninguna versión. Se crean con la API (ver docs/CANCELLATIONS.md) tras validarlas jurídica y comercialmente.</Text> : null}
          {(data.policies ?? []).map((p: any) => (
            <View key={p.id} style={s.card}>
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>Versión {p.version}</Text>
                <Text style={[s.pill, p.status !== "active" && s.pillDone]}>{STATUS_LABEL[p.status]}</Text>
              </View>
              {p.notes ? <Text style={s.meta}>{p.notes}</Text> : null}
              {p.status === "draft" ? <Btn label="Activar esta versión" onPress={() => act(`/v1/admin/cancellation-policies/${p.id}/activate`, {}, `Política v${p.version} activa.`)} /> : null}
            </View>
          ))}
        </>
      ) : null}

      {tab === "users" ? (
        <>
          <View style={s.row}>
            <TextInput value={query} onChangeText={setQuery} placeholder="Nombre o correo" style={[s.input, { flex: 1, minWidth: 0 }]} onSubmitEditing={() => void load()} />
            <Btn label="Buscar" onPress={() => void load()} />
          </View>
          {data?.users?.map((u: any) => (
            <View key={u.id} style={s.card}>
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>{u.display_name || "Sin nombre"}</Text>
                <Text style={[s.pill, u.status !== "active" && s.pillBad]}>{STATUS_LABEL[u.status]}</Text>
              </View>
              <Text style={s.meta}>
                {u.email ?? "sin correo"} · {u.roles.map((r: string) => ROLE_LABEL[r] ?? r).join(", ") || "sin rol"} · {u.rating ? `★ ${u.rating}` : "sin valoraciones"} · {u.reports_against} reportes
              </Text>
              {mine.includes("admin") ? (
                <>
                  {noteInput(`u:${u.id}`, "Motivo")}
                  <View style={s.row}>
                    {u.status === "active"
                      ? <Btn label="Suspender" danger onPress={() => act(`/v1/admin/users/${u.id}/status`, { status: "suspended", reason: note(`u:${u.id}`) }, "Cuenta suspendida y sesiones cerradas.")} />
                      : <Btn label="Reactivar" onPress={() => act(`/v1/admin/users/${u.id}/status`, { status: "active", reason: note(`u:${u.id}`) }, "Cuenta reactivada.")} />}
                  </View>
                </>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {tab === "legal" && data ? (
        <>
          <Text style={s.meta}>
            MVC no trae textos legales propios: el texto lo redacta vuestro asesor. Al publicar una versión nueva, todos tienen que aceptarla antes de volver a reservar o publicar.
          </Text>
          {!data.documents.length ? <Text style={s.empty}>Aún no hay condiciones ni aviso de privacidad.</Text> : null}
          {data.documents.map((d: any) => (
            <View key={d.id} style={s.card}>
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>{d.kind === "terms" ? "Condiciones de uso" : "Privacidad"} v{d.version} · {d.title}</Text>
                <Text style={s.pill}>{d.status === "published" ? "Publicada" : d.status === "draft" ? "Borrador" : "Retirada"}</Text>
              </View>
              <Text style={s.meta} numberOfLines={3}>{d.body}</Text>
              <Text style={s.meta}>{d.acceptances} {d.acceptances === 1 ? "aceptación" : "aceptaciones"}{d.published_at ? ` · publicada ${when(d.published_at)}` : ""}</Text>
              {d.status === "draft" ? (
                <Btn label="Publicar" onPress={() => void act(`/v1/admin/legal-documents/${d.id}/publish`, {}, "Publicada. Se pedirá aceptarla a todos.")} />
              ) : null}
            </View>
          ))}
          {(["terms", "privacy"] as const).map(kind => (
            <View key={kind} style={s.card}>
              <Text style={s.cardTitle}>Nuevo borrador: {kind === "terms" ? "condiciones de uso" : "aviso de privacidad"}</Text>
              {noteInput(`l:${kind}:title`, "Título")}
              <TextInput
                value={notes[`l:${kind}:body`] ?? ""}
                onChangeText={v => setNotes(c => ({ ...c, [`l:${kind}:body`]: v }))}
                placeholder="Pega aquí el texto aprobado"
                style={[s.input, { minHeight: 110, paddingTop: 8, textAlignVertical: "top" }]}
                multiline
              />
              <Btn
                label="Guardar borrador"
                onPress={() => {
                  if (!note(`l:${kind}:title`) || !note(`l:${kind}:body`)) return setError("Escribe título y texto.");
                  void act("/v1/admin/legal-documents", { kind, title: note(`l:${kind}:title`), body: note(`l:${kind}:body`) }, "Borrador guardado. Revísalo y publícalo cuando esté aprobado.");
                }}
              />
            </View>
          ))}
        </>
      ) : null}

      {tab === "audit" && data ? (
        <>
          {data.events.map((e: any) => (
            <View key={e.id} style={s.auditRow}>
              <Text style={s.auditAction}>{AUDIT_LABEL[e.action] ?? e.action}</Text>
              <Text style={s.meta}>{e.actor_display_name || (e.actor_user_id ? "Usuario" : "Sistema")} · {e.entity_type} · {when(e.created_at)}</Text>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function Stat({ icon, label, value, tone, onPress }: { icon: any; label: string; value: number | string; tone?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.stat}>
      <Ionicons name={icon} size={20} color={tone ?? C.blue} />
      <Text style={[s.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </Pressable>
  );
}

function Btn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.btn, danger && s.btnDanger]}>
      <Text style={[s.btnText, danger && { color: "#C93A3A" }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 30, backgroundColor: "#fff" },
  title: { fontSize: 25, fontWeight: "900", color: C.navy },
  subtitle: { fontSize: 12, lineHeight: 17, color: C.muted, marginTop: 4, marginBottom: 12 },
  tabs: { gap: 6, paddingBottom: 12 },
  tab: { borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  tabOn: { backgroundColor: C.navy, borderColor: C.navy },
  tabText: { fontSize: 12, fontWeight: "900", color: C.navy },
  tabTextOn: { color: "#fff" },
  error: { color: "#9E302D", backgroundColor: "#FFF0EF", padding: 10, borderRadius: 12, fontSize: 12, marginBottom: 10 },
  ok: { color: "#0E7A55", backgroundColor: C.mintPale, padding: 10, borderRadius: 12, fontSize: 12, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexBasis: "47%", flexGrow: 1, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, gap: 4 },
  statValue: { fontSize: 24, fontWeight: "900", color: C.navy, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 11, fontWeight: "700", color: C.muted },
  section: { fontSize: 14, fontWeight: "900", color: C.navy, marginTop: 14, marginBottom: 8 },
  pillOff: { backgroundColor: "#FFF6E8", color: "#966112" },
  subsection: { fontSize: 13, fontWeight: "900", color: C.navy, marginTop: 10, marginBottom: 6, flex: 1 },
  warnBox: { fontSize: 12, lineHeight: 17, color: "#966112", backgroundColor: "#FFF6E8", padding: 10, borderRadius: 12, marginBottom: 8 },
  empty: { fontSize: 12, color: C.muted, lineHeight: 17 },
  hint: { fontSize: 11, color: C.muted, lineHeight: 16, marginTop: 4 },
  card: { borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12, marginBottom: 8, gap: 6 },
  cardTitle: { fontSize: 13, fontWeight: "900", color: C.navy, flexShrink: 1 },
  meta: { fontSize: 11, color: C.muted, lineHeight: 16 },
  body: { fontSize: 12, color: C.text, lineHeight: 17 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  pill: { fontSize: 10, fontWeight: "900", color: C.blue, backgroundColor: C.pale, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" },
  pillDone: { color: C.muted, backgroundColor: "#F1F4F9" },
  pillBad: { color: "#C93A3A", backgroundColor: "#FFF0EF" },
  input: { minHeight: 40, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, fontSize: 13, color: C.navy },
  small: { flexBasis: "47%", flexGrow: 1, minWidth: 0 },
  btn: { borderWidth: 1, borderColor: C.blue, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 },
  btnDanger: { borderColor: "#E8B4B4" },
  btnText: { fontSize: 12, fontWeight: "900", color: C.blue },
  auditRow: { borderBottomWidth: 1, borderBottomColor: "#EEF3FA", paddingVertical: 8 },
  auditAction: { fontSize: 12, fontWeight: "900", color: C.navy },
});
