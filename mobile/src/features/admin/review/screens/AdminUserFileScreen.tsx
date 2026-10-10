import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AdminReviewDecision, AdminReviewItemKey } from "@/api/types";
import { useAppNavigation, type AppScreenProps } from "@/navigation";
import { formatDateTime } from "@/i18n";
import { Avatar, Banner, Button, ConfirmDialog, Screen, StatusPill, Text, showToast } from "@/ui";
import { PanelCard } from "../../ops/components/PanelCard";
import { AdminHeader } from "../components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../components/AccessStates";
import { EvidenceViewerSheet } from "../components/EvidenceViewerSheet";
import { CardListSkeleton } from "../components/ListStates";
import { PillTabs } from "../components/PillTabs";
import { ReasonSheet } from "../components/ReasonSheet";
import { StaffAccessSheet } from "../components/StaffAccessSheet";
import { useAdminGate } from "../hooks/useAdminGate";
import { useEvidenceViewer } from "../hooks/useEvidenceViewer";
import { useReviewDecision, useReviewDossier, useVehicleReview } from "../hooks/useReviewDossier";
import { DOSSIER_TABS, dossierItemView, historyView, isOwnDossier, reasonOptionsFor, vehicleView, type DossierTab, type VehicleArea } from "../logic/dossier";
import { adminError } from "../logic/errors";
import { evidencePurpose } from "../logic/evidence";
import { staffInitial } from "../logic/permissions";
import { reviewStrings } from "../strings";

const d = reviewStrings.dossier;

type Pending =
  | { kind: "approve"; item: AdminReviewItemKey; label: string }
  | { kind: "reject"; item: AdminReviewItemKey; label: string }
  | { kind: "retry"; item: AdminReviewItemKey; label: string }
  | { kind: "vehicleReject"; vehicleId: string; area: VehicleArea; label: string }
  | { kind: "vehicleApprove"; vehicleId: string; area: VehicleArea; label: string };

/**
 * Expediente de una persona (sin lámina; se abre desde «Ver expediente» de la 38): resumen, elementos entregados con su
 * documentación privada (visor con aviso, 2 minutos y registro de acceso), vehículos e historial. Las decisiones llevan
 * motivo cuando hacen falta y quedan a nombre de quien decide. Nadie revisa ni abre su propia documentación.
 */
export function AdminUserFileScreen({ route }: AppScreenProps<"AdminUserFile">): React.JSX.Element {
  const { userId } = route.params;
  const navigation = useAppNavigation();
  const gate = useAdminGate((access) => access.canRead("review"));
  const { access } = gate;
  const ready = gate.state === "ready";
  const query = useReviewDossier(userId, ready);
  const decide = useReviewDecision();
  const vehicleReview = useVehicleReview();
  const viewer = useEvidenceViewer();
  const [tab, setTab] = useState<DossierTab>("items");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = query.data;
  const own = data !== undefined && isOwnDossier(data, access.me?.userId);
  const canWrite = access.canWrite("review");
  const busy = decide.isPending || vehicleReview.isPending;

  const done = (message: string): void => {
    setPending(null);
    setError(null);
    showToast({ kind: "success", message, id: "dossier.decision" });
    void query.refetch();
  };

  const runItem = async (item: AdminReviewItemKey, decision: AdminReviewDecision, extra: { reason?: string; reasonCode?: string | null }): Promise<void> => {
    setError(null);
    try {
      const result = await decide.mutateAsync({
        userId,
        body: { decision, items: [item], ...(extra.reason !== undefined && extra.reason !== "" ? { reason: extra.reason } : {}), ...(extra.reasonCode !== null && extra.reasonCode !== undefined ? { reasonCode: extra.reasonCode as never } : {}) },
      });
      const first = result.results[0];
      if (first !== undefined && first.outcome === "skipped") {
        setPending(null);
        showToast({ kind: "error", message: first.message ?? reviewStrings.users.staleMessage, id: "dossier.decision" });
        void query.refetch();
        return;
      }
      done(d.decisionDone(pending !== null ? pending.label : "", d.decisionWords[decision]));
    } catch (failure) {
      setError(adminError(failure).message);
      void query.refetch();
    }
  };

  const runVehicle = async (vehicleId: string, area: VehicleArea, decision: "approved" | "rejected", reason?: string): Promise<void> => {
    setError(null);
    try {
      await vehicleReview.mutateAsync({ vehicleId, body: { area, decision, ...(reason !== undefined && reason !== "" ? { reason } : {}) } });
      done(d.decisionDone(pending !== null ? pending.label : "", decision === "approved" ? d.decisionWords.approved : d.decisionWords.rejected));
    } catch (failure) {
      setError(adminError(failure).message);
      void query.refetch();
    }
  };

  const header = (
    <View>
      <AdminHeader subtitle={d.title} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} testID="AdminUserFile.header" />
    </View>
  );

  let body: React.ReactNode;
  if (gate.state === "checking") body = <CheckingAccess />;
  else if (gate.state === "error" && gate.error !== null) body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminUserFile.error" />;
  else if (gate.state === "denied") body = <NoPermission testID="AdminUserFile.denied" message={reviewStrings.access.deniedMessage(reviewStrings.access.areaLabels.review)} onGoHome={gate.goHome} />;
  else if (data === undefined) {
    if (query.isError || query.isOffline) {
      const failure = adminError(query.error);
      body = <PanelError error={failure.kind === "notFound" ? { ...failure, title: d.notFoundTitle, message: d.notFoundMessage } : failure} onRetry={() => void query.refetch()} onGoHome={() => navigation.navigate("AdminUsersReview")} testID="AdminUserFile.loadError" />;
    } else body = <CardListSkeleton testID="AdminUserFile.loading" count={3} />;
  } else {
    const ctx = { canWrite, isOwn: own };
    const items = data.items.map((item) => ({ item, view: dossierItemView(item, ctx) }));
    const vehicles = data.vehicles.map((vehicle) => vehicleView(vehicle, ctx));
    const history = historyView(data.history);
    const pendingCount = items.filter((entry) => entry.view.state === "in_review").length;
    body = (
      <>
        <View style={styles.summary} testID="AdminUserFile.summary">
          <Avatar source={data.user.photoUrl} name={data.user.displayName} size={64} />
          <View style={styles.flex}>
            <Text variant="titleSm" color="heading" size={20} numberOfLines={1}>{data.user.displayName}</Text>
            <Text variant="body" color="muted" size={14.5}>{data.user.phoneMasked !== null ? d.phone(data.user.phoneMasked) : d.phoneUnknown}</Text>
            <Text variant="body" color="muted" size={14.5}>{d.createdAt(formatDateTime(data.user.createdAt))}</Text>
          </View>
          <StatusPill label={d.statusLabels[data.user.status]} tone={data.user.status === "active" ? "green" : "red"} size="sm" />
        </View>
        <Text variant="body" color="body" size={15.5} style={styles.pendingLine} testID="AdminUserFile.pending">{d.pendingCount(pendingCount)}</Text>
        {own ? <Banner kind="notice" message={d.selfReview} style={styles.gap} testID="AdminUserFile.self" /> : null}
        <View style={styles.tabs}>
          <PillTabs tabs={DOSSIER_TABS.map((t) => ({ value: t.value, label: t.label, badge: null }))} value={tab} onChange={setTab} accessibilityLabel={d.tabsA11y} testID="AdminUserFile.tab" />
        </View>

        {tab === "items" ? (
          <View style={styles.list} testID="AdminUserFile.items">
            {items.map(({ item, view }) => (
              <PanelCard key={view.key} title={view.label} right={<StatusPill label={view.stateLabel} tone={view.tone} size="sm" />} testID={`AdminUserFile.item.${view.key}`}>
                {view.badge !== null ? <Text variant="body" color="warning" size={14.5}>{view.badge}</Text> : null}
                <Text variant="body" color="muted" size={14.5}>{view.submitted}</Text>
                {view.decided !== null ? <Text variant="body" color="muted" size={14.5}>{view.decided}</Text> : null}
                {view.reason !== null ? <Text variant="body" color="body" size={14.5}>{view.reason}</Text> : null}
                {view.evidence.length > 0 ? <Text variant="rowTitle" color="heading" size={15.5} style={styles.top}>{d.evidenceTitle}</Text> : <Text variant="body" color="muted" size={14.5} style={styles.top}>{d.evidenceNone}</Text>}
                {view.evidence.map((ev) => (
                  <View key={ev.id} style={styles.evidence} testID={`AdminUserFile.evidence.${ev.id}`}>
                    <View style={styles.flex}>
                      <Text variant="body" color="deep" size={15}>{ev.label}</Text>
                      <Text variant="body" color="muted" size={13}>{ev.meta}</Text>
                    </View>
                    <Button
                      testID={`AdminUserFile.evidence.${ev.id}.view`}
                      label={d.viewEvidence}
                      accessibilityLabel={d.viewEvidenceA11y(ev.label)}
                      variant="outline"
                      size="sm"
                      inline
                      chevron={false}
                      disabled={own || !access.canRead("evidence")}
                      onPress={() => viewer.open({ kind: ev.kind, id: ev.id, title: ev.label, ownerName: data.user.displayName, purpose: evidencePurpose(view.key) })}
                    />
                  </View>
                ))}
                {view.decisionsBlockedReason !== null ? <Text variant="body" color="muted" size={14.5} style={styles.top}>{view.decisionsBlockedReason}</Text> : null}
                {view.decisionsBlockedReason === null && view.decisions.length === 0 ? <Text variant="body" color="muted" size={14.5} style={styles.top}>{d.decisionNone}</Text> : null}
                {view.decisions.length > 0 ? (
                  <View style={styles.decisions}>
                    {view.decisions.includes("approved") ? <Button testID={`AdminUserFile.item.${view.key}.approve`} label={d.approve} chevron={false} disabled={busy} onPress={() => setPending({ kind: "approve", item: view.key, label: view.label })} /> : null}
                    {view.decisions.includes("rejected") ? <Button testID={`AdminUserFile.item.${view.key}.reject`} label={d.reject} variant="danger" chevron={false} disabled={busy} onPress={() => { setError(null); setPending({ kind: "reject", item: view.key, label: view.label }); }} /> : null}
                    {view.decisions.includes("needs_retry") ? <Button testID={`AdminUserFile.item.${view.key}.retry`} label={d.askRetry} variant="outline" chevron={false} disabled={busy} onPress={() => { setError(null); setPending({ kind: "retry", item: view.key, label: view.label }); }} /> : null}
                  </View>
                ) : null}
              </PanelCard>
            ))}
          </View>
        ) : null}

        {tab === "vehicles" ? (
          <View style={styles.list} testID="AdminUserFile.vehicles">
            {vehicles.length === 0 ? <Text variant="body" color="muted" size={15.5}>{d.vehiclesEmpty}</Text> : <Text variant="body" color="muted" size={14.5}>{d.vehiclesNote}</Text>}
            {vehicles.map((vehicle) => (
              <PanelCard key={vehicle.id} title={`${vehicle.title} · ${vehicle.plate}`} testID={`AdminUserFile.vehicle.${vehicle.id}`}>
                {vehicle.areas.map((area) => (
                  <View key={area.area} style={styles.areaRow} testID={`AdminUserFile.vehicle.${vehicle.id}.${area.area}`}>
                    <View style={styles.areaHead}>
                      <Text variant="body" color="deep" size={15.5} style={styles.flex}>{area.label}</Text>
                      <StatusPill label={area.statusLabel} tone={area.tone} size="sm" />
                    </View>
                    {area.decidable ? (
                      <View style={styles.decisions}>
                        <Button testID={`AdminUserFile.vehicle.${vehicle.id}.${area.area}.approve`} label={d.vehicleApprove} chevron={false} disabled={busy} onPress={() => setPending({ kind: "vehicleApprove", vehicleId: vehicle.id, area: area.area, label: `${vehicle.title}: ${area.label}` })} />
                        <Button testID={`AdminUserFile.vehicle.${vehicle.id}.${area.area}.reject`} label={d.vehicleReject} variant="danger" chevron={false} disabled={busy} onPress={() => { setError(null); setPending({ kind: "vehicleReject", vehicleId: vehicle.id, area: area.area, label: `${vehicle.title}: ${area.label}` }); }} />
                      </View>
                    ) : area.status !== "pending" ? null : <Text variant="body" color="muted" size={13.5}>{own ? d.selfReview : d.decisionNoPermission}</Text>}
                  </View>
                ))}
              </PanelCard>
            ))}
          </View>
        ) : null}

        {tab === "history" ? (
          <View style={styles.list} testID="AdminUserFile.history">
            {history.length === 0 ? <Text variant="body" color="muted" size={15.5}>{d.historyEmpty}</Text> : null}
            {history.map((event) => (
              <View key={event.key} style={styles.event} accessible>
                <Text variant="body" color="deep" size={15.5}>{event.summary}</Text>
                <Text variant="body" color="muted" size={13.5}>{event.actor !== null ? `${event.when} · ${event.actor}` : event.when}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.note}><Text variant="body" color="muted" size={13.5}>{data.accessNote !== "" ? data.accessNote : d.accessNoteFallback}</Text></View>
      </>
    );
  }

  const rejectingItem = pending !== null && pending.kind === "reject" && data !== undefined ? data.items.find((i) => i.key === pending.item) : undefined;
  const retryingItem = pending !== null && pending.kind === "retry" && data !== undefined ? data.items.find((i) => i.key === pending.item) : undefined;

  return (
    <>
      <Screen testID="AdminUserFile" header={header} paddingX={11} refreshing={query.isRefreshing} onRefresh={ready ? () => void query.refetch() : undefined} contentContainerStyle={styles.content}>
        {body}
      </Screen>

      <ConfirmDialog
        visible={pending !== null && (pending.kind === "approve" || pending.kind === "vehicleApprove")}
        title={pending !== null ? d.approveItemTitle(pending.label) : ""}
        message={d.approveItemMessage}
        confirmLabel={d.approve}
        icon="checkBold"
        loading={busy}
        onConfirm={() => {
          if (pending === null) return;
          if (pending.kind === "approve") void runItem(pending.item, "approved", {});
          else if (pending.kind === "vehicleApprove") void runVehicle(pending.vehicleId, pending.area, "approved");
        }}
        onCancel={() => setPending(null)}
        testID="AdminUserFile.approveDialog"
      />
      <ReasonSheet
        visible={pending !== null && (pending.kind === "reject" || pending.kind === "vehicleReject")}
        title={pending !== null ? d.rejectItemTitle(pending.label) : ""}
        confirmLabel={d.reject}
        tone="danger"
        busy={busy}
        errorMessage={error}
        codeOptions={rejectingItem !== undefined ? reasonOptionsFor(rejectingItem, "rejected").map((o) => ({ value: o.code, label: o.label })) : undefined}
        codeLabel={d.reasonCodeLabel}
        textRequired
        textLabel={reviewStrings.users.rejectReasonLabel}
        textPlaceholder={reviewStrings.users.rejectReasonPlaceholder}
        textHelper={reviewStrings.users.rejectReasonHelper}
        onConfirm={(input) => {
          if (pending === null) return;
          if (pending.kind === "reject") void runItem(pending.item, "rejected", { reason: input.reason, reasonCode: input.reasonCode });
          else if (pending.kind === "vehicleReject") void runVehicle(pending.vehicleId, pending.area, "rejected", input.reason);
        }}
        onClose={() => setPending(null)}
        testID="AdminUserFile.rejectSheet"
      />
      <ReasonSheet
        visible={pending !== null && pending.kind === "retry"}
        title={d.retrySheetTitle}
        subtitle={d.retrySheetSubtitle}
        confirmLabel={d.retryConfirm}
        tone="primary"
        busy={busy}
        errorMessage={error}
        codeOptions={retryingItem !== undefined ? reasonOptionsFor(retryingItem, "needs_retry").map((o) => ({ value: o.code, label: o.label })) : undefined}
        codeLabel={d.retryReasonLabel}
        codeRequired
        textRequired={false}
        textLabel={reviewStrings.users.rejectReasonLabel}
        textPlaceholder={reviewStrings.users.rejectReasonPlaceholder}
        textHelper={reviewStrings.users.rejectReasonHelper}
        onConfirm={(input) => {
          if (pending !== null && pending.kind === "retry") void runItem(pending.item, "needs_retry", { reason: input.reason, reasonCode: input.reasonCode });
        }}
        onClose={() => setPending(null)}
        testID="AdminUserFile.retrySheet"
      />
      <EvidenceViewerSheet viewer={viewer} testID="AdminUserFile.viewer" />
      <StaffAccessSheet visible={gate.sheetOpen} onClose={gate.closeSheet} me={access.me} loading={access.query.isLoading || access.query.isIdle} error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 10, paddingBottom: 24 },
  summary: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4 },
  pendingLine: { marginTop: 10, paddingHorizontal: 4 },
  gap: { marginTop: 10 },
  tabs: { marginTop: 12 },
  list: { marginTop: 12, gap: 10 },
  top: { marginTop: 10 },
  evidence: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  decisions: { marginTop: 12, gap: 10 },
  areaRow: { marginTop: 8 },
  areaHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  event: { gap: 2, paddingVertical: 4 },
  note: { marginTop: 18, paddingHorizontal: 4 },
});
