import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { AdminTariffPublishRequest, AdminTariffVersion } from "@/api/types";
import { formatDateTime, formatRelative } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, EmptyState, Screen, StatusPill, Text, showToast, type StatusTone } from "@/ui";
import { AdminHeader } from "../../review/components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../../review/components/AccessStates";
import { CardListSkeleton, LoadMore, RefreshFailedStrip } from "../../review/components/ListStates";
import { StaffAccessSheet } from "../../review/components/StaffAccessSheet";
import { useAdminGate } from "../../review/hooks/useAdminGate";
import { adminError } from "../../review/logic/errors";
import { staffInitial } from "../../review/logic/permissions";
import { backofficeStrings } from "../backofficeStrings";
import { ActivateSheet } from "../components/ExtraCards";
import { usePublishTariff, useTariffOverview, useTariffVersions } from "../hooks/useTariffs";
import { formatCapLabel, formatCommissionLabel, formatPremiumLabel, formatRateLabel } from "../model/money";
import { isDraftComplete } from "../model/tariff";
import { opsStrings } from "../strings";

const s = backofficeStrings.versions;
const TONE: Record<string, StatusTone> = { draft: "gray", approved: "green", retired: "gray" };

function Row({ label, value, pending }: { label: string; value: string; pending: boolean }): React.JSX.Element {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="body" color="muted" size={15} style={styles.flex}>{label}</Text>
      <Text variant="titleSm" color={pending ? colors.warning.textStrong : "heading"} size={16}>{value}</Text>
    </View>
  );
}

function VersionCard({ version, children }: { version: AdminTariffVersion; children?: React.ReactNode }): React.JSX.Element {
  const p = s.pending;
  const dateLine =
    version.status === "approved" && version.effectiveFrom !== null
      ? s.from(formatDateTime(version.effectiveFrom))
      : version.status === "retired"
        ? s.retiredAt(formatRelative(version.updatedAt).toLocaleLowerCase("es-ES"))
        : s.updated(formatRelative(version.updatedAt).toLocaleLowerCase("es-ES"));
  return (
    <View style={styles.card} testID={`AdminTariffVersions.version.${version.id}`}>
      <View style={styles.head}>
        <Text variant="titleSm" color="heading" size={18} style={styles.flex}>{s.version(version.version)}</Text>
        <StatusPill label={s.status[version.status] ?? version.status} tone={TONE[version.status] ?? "gray"} size="sm" />
      </View>
      <Row label={s.rate} value={formatRateLabel(version.ratePerKmMicros, p)} pending={version.ratePerKmMicros === null} />
      <Row label={s.passenger} value={formatCommissionLabel(version.passengerCommissionBps, p)} pending={version.passengerCommissionBps === null} />
      <Row label={s.driver} value={formatCommissionLabel(version.driverCommissionBps, p)} pending={version.driverCommissionBps === null} />
      <Row label={s.premium} value={formatPremiumLabel(version.premiumMonthlyCents, p)} pending={version.premiumMonthlyCents === null} />
      <Row label={s.cap} value={formatCapLabel(version.sharedCostCapCents, s.noCap)} pending={false} />
      {version.approvalReference !== null ? <Text variant="body" color="success" size={14.5}>{s.reference(version.approvalReference)}</Text> : null}
      {version.notes !== null && version.notes.trim() !== "" ? (
        <View>
          <Text variant="caption" color="subtle" size={13}>{s.notes}</Text>
          <Text variant="body" color="body" size={15}>{version.notes}</Text>
        </View>
      ) : null}
      <Text variant="caption" color="subtle" size={13}>{dateLine}</Text>
      {children}
    </View>
  );
}

/**
 * Versiones de tarifa (sin lámina): borradores, tarifa en vigor y retiradas, de la más nueva a la más antigua. Activar
 * una versión reutiliza la hoja de activación de «Tarifas»: pide la referencia de la decisión aprobada y está bloqueada
 * mientras la economía no esté activada.
 */
export function AdminTariffVersionsScreen({ navigation }: AppScreenProps<"AdminTariffVersions">): React.JSX.Element {
  const gate = useAdminGate((access) => access.canRead("tariffs"));
  const { access } = gate;
  const ready = gate.state === "ready";
  const versions = useTariffVersions(ready);
  const overview = useTariffOverview(ready);
  const publish = usePublishTariff();
  const [target, setTarget] = useState<AdminTariffVersion | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);

  const canActivate = access.canWrite("tariff_activation");
  const canPublish = overview.data?.activation.canPublish === true;

  const onActivate = async (request: AdminTariffPublishRequest): Promise<void> => {
    if (target === null) return;
    setActivateError(null);
    try {
      await publish.mutateAsync({ versionId: target.id, request });
      setTarget(null);
      showToast({ kind: "success", title: opsStrings.activate.success, message: opsStrings.activate.successDetail, id: "versions" });
    } catch (error) {
      const info = describeError(error);
      setActivateError(info.code === "ECONOMICS_ACTIVATION_DISABLED" ? opsStrings.activate.blocked : info.message);
    }
  };

  const listError = versions.isError ? adminError(versions.error) : null;
  const loading = versions.isIdle || versions.isLoading;
  const items = useMemo(() => versions.items, [versions.items]);

  let body: React.ReactNode;
  if (gate.state === "checking") body = <CheckingAccess />;
  else if (gate.state === "error" && gate.error !== null) body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminTariffVersions.error" />;
  else if (gate.state === "denied") body = <NoPermission testID="AdminTariffVersions.denied" message={s.deniedMessage} onGoHome={gate.goHome} />;
  else if (listError !== null) body = <PanelError error={listError} onRetry={() => void versions.refresh()} onGoHome={gate.goHome} testID="AdminTariffVersions.listError" />;
  else if (loading) body = <CardListSkeleton testID="AdminTariffVersions.loading" />;
  else if (versions.isEmpty) {
    body = <EmptyState testID="AdminTariffVersions.empty" icon="receipt" title={s.emptyTitle} message={s.emptyMessage} actionLabel={s.openDraft} onAction={() => navigation.navigate("AdminTariffsOps")} />;
  } else {
    body = (
      <>
        {versions.failedToRefresh ? <RefreshFailedStrip offline={versions.isOffline} onRetry={() => void versions.refresh()} /> : null}
        <Text variant="body" color="body" size={15.5} style={styles.intro}>{s.intro}</Text>
        {items.map((version) => {
          const activatable = version.status === "draft" && isDraftComplete(version);
          return (
            <View key={version.id} style={styles.gap}>
              <VersionCard version={version}>
                {version.status === "draft" ? (
                  <View style={styles.actions}>
                    {!canActivate ? (
                      <Text variant="caption" color="muted" size={13} testID={`AdminTariffVersions.version.${version.id}.adminOnly`}>{s.activateAdminOnly}</Text>
                    ) : !canPublish ? (
                      <Banner kind="warning" size="xs" message={s.activateBlocked} testID={`AdminTariffVersions.version.${version.id}.blocked`} />
                    ) : (
                      <Button
                        testID={`AdminTariffVersions.version.${version.id}.activate`}
                        label={s.activate}
                        variant="outline"
                        size="sm"
                        chevron={false}
                        disabled={!activatable}
                        onPress={() => {
                          setActivateError(null);
                          setTarget(version);
                        }}
                      />
                    )}
                    <Button testID={`AdminTariffVersions.version.${version.id}.open`} label={s.openDraft} variant="outline" size="sm" chevron={false} onPress={() => navigation.navigate("AdminTariffsOps")} />
                  </View>
                ) : null}
              </VersionCard>
            </View>
          );
        })}
        <LoadMore hasMore={versions.hasMore} loading={versions.isFetchingMore} failed={versions.fetchMoreError !== null} onPress={() => void versions.fetchMore()} testID="AdminTariffVersions.more" />
      </>
    );
  }

  return (
    <>
      <Screen
        testID="AdminTariffVersions"
        header={<AdminHeader subtitle={s.subtitle} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("AdminHome"))} testID="AdminTariffVersions.header" />}
        paddingX={11}
        refreshing={versions.isRefreshing}
        onRefresh={ready ? () => void versions.refresh() : undefined}
        contentContainerStyle={styles.list}
      >
        {body}
      </Screen>
      <ActivateSheet visible={target !== null} busy={publish.isPending} serverError={activateError} onClose={() => setTarget(null)} onSubmit={(request) => void onActivate(request)} />
      <StaffAccessSheet visible={gate.sheetOpen} onClose={gate.closeSheet} me={access.me} loading={access.query.isLoading || access.query.isIdle} error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingTop: 12, paddingBottom: 16 },
  intro: { marginBottom: 12, paddingHorizontal: 3 },
  gap: { marginTop: 10 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  actions: { gap: 8, marginTop: 4 },
});
