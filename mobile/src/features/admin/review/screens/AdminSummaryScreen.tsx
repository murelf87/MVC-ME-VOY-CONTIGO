/**
 * 37 · Resumen de administración: provincia y periodo, seis indicadores (actividad y, solo para Finanzas/Administración,
 * económicos) con su variación frente al periodo anterior, y la actividad de vehículos en un mapa (aproximada: celdas,
 * sin identidades). Un indicador sin fuente muestra «—», un importe sin tarifa aprobada «Por definir» y uno de ejemplo
 * «Datos ilustrativos». Si falla el mapa, los indicadores se siguen viendo (consultas independientes).
 */
import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AdminPeriod } from "@/api/types";
import { formatTime } from "@/i18n";
import { MapLegend, MvcMap } from "@/maps";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { BottomSheet, Button, MapCard, Screen, StatTile, Text } from "@/ui";
import { AdminHeader } from "../components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../components/AccessStates";
import { FilterSelect } from "../components/FilterSelect";
import { CardListSkeleton, RefreshFailedStrip } from "../components/ListStates";
import { StaffAccessSheet } from "../components/StaffAccessSheet";
import { useAdminGate } from "../hooks/useAdminGate";
import { useAdminSummary, useVehicleActivity } from "../hooks/useAdminSummary";
import { useProvinceFilter } from "../hooks/useProvinceFilter";
import { adminError } from "../logic/errors";
import { summaryPeriodOptions } from "../logic/filters";
import { staffInitial } from "../logic/permissions";
import { activityInfoBody, activityMarkers, summaryView } from "../logic/summary";
import { reviewStrings } from "../strings";

const s = reviewStrings.summary;

export function AdminSummaryScreen(_props: AppScreenProps<"AdminSummary">): React.JSX.Element {
  const gate = useAdminGate((access) => access.canRead("summary"));
  const { access } = gate;
  const ready = gate.state === "ready";
  const province = useProvinceFilter();
  const [period, setPeriod] = useState<AdminPeriod>("today");
  const [info, setInfo] = useState(false);
  const enabled = ready && province.ready;

  const summary = useAdminSummary(province.selected.id, period, enabled);
  const activity = useVehicleActivity(province.selected.id, enabled);
  const periods = useMemo(summaryPeriodOptions, []);
  const view = summary.data !== undefined ? summaryView(summary.data) : null;
  const markers = useMemo(() => (activity.data !== undefined ? activityMarkers(activity.data.items) : []), [activity.data]);
  const summaryError = summary.data === undefined && summary.isError ? adminError(summary.error) : null;

  let body: React.ReactNode;
  if (gate.state === "checking") body = <CheckingAccess />;
  else if (gate.state === "error" && gate.error !== null) body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminSummary.error" />;
  else if (gate.state === "denied") body = <NoPermission testID="AdminSummary.denied" message={reviewStrings.access.deniedMessage(reviewStrings.access.areaLabels.summary)} onGoHome={gate.goHome} />;
  else if (summaryError !== null) body = <PanelError error={summaryError} onRetry={() => void summary.refetch()} onGoHome={gate.goHome} testID="AdminSummary.loadError" />;
  else if (view === null) body = <CardListSkeleton testID="AdminSummary.loading" count={3} />;
  else {
    body = (
      <>
        {summary.isError ? <RefreshFailedStrip offline={summary.isOffline} onRetry={() => void summary.refetch()} /> : null}
        <View style={styles.grid} testID="AdminSummary.tiles">
          {view.tiles.map((tile) => (
            <View key={tile.key} style={styles.cell}>
              <StatTile
                testID={`AdminSummary.tile.${tile.key}`}
                icon={tile.icon}
                iconTone={tile.iconTone}
                value={tile.value}
                label={tile.label}
                trend={tile.trend !== null && tile.trend.direction !== "flat" ? { direction: tile.trend.direction, text: tile.trend.text } : undefined}
                caption={tile.trend !== null && tile.trend.direction === "flat" ? tile.trend.text : (tile.caption ?? undefined)}
              />
            </View>
          ))}
        </View>
        {view.financeHidden !== null ? <Text variant="body" color="muted" size={14.5} style={styles.note} testID="AdminSummary.financeHidden">{view.financeHidden}</Text> : null}
        {view.notes.map((note, index) => <Text key={index} variant="body" color="muted" size={14} style={styles.note}>{note}</Text>)}

        <View style={styles.mapBox} testID="AdminSummary.activity">
          <Text variant="titleSm" color="heading" size={17} style={styles.mapTitle}>{s.mapTitle}</Text>
          <MapCard
            height={250}
            radius={0}
            style={styles.mapFlush}
            status={activity.data === undefined ? (activity.isError || activity.isOffline ? "unavailable" : "loading") : "ready"}
            unavailableTitle={s.mapLoadError}
            unavailableMessage=""
            onRetry={() => void activity.refetch()}
            accessibilityLabel={activity.data !== undefined ? s.mapA11y(activity.data.totalVehicles) : s.mapTitle}
            testID="AdminSummary.map"
          >
            <MvcMap lite style={styles.flex} markers={markers} fit="content" fitKey={`${province.selected.id ?? "all"}-${markers.length}`} />
          </MapCard>
          {activity.data !== undefined && activity.data.items.length === 0 ? (
            <Text variant="body" color="muted" size={14.5} testID="AdminSummary.mapEmpty">{`${s.mapEmptyTitle}. ${s.mapEmptyMessage}`}</Text>
          ) : null}
          <MapLegend variant="footer" style={styles.legend} items={[{ icon: "dot", label: s.legendVehicles, color: colors.primary }]} note={s.legendNote} onNotePress={() => setInfo(true)} testID="AdminSummary.legend" />
          {activity.data !== undefined ? <Text variant="body" color="muted" size={13.5} style={styles.legend}>{s.mapUpdated(formatTime(activity.data.generatedAt))}</Text> : null}
        </View>
        <Text variant="body" color="muted" size={13.5} style={styles.note}>{s.comparedWith}</Text>
      </>
    );
  }

  const header = (
    <View>
      <AdminHeader subtitle={s.subtitle} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} testID="AdminSummary.header" />
      {ready ? (
        <View style={styles.filters}>
          <FilterSelect<string>
            testID="AdminSummary.filter.province"
            value={province.selectedValue}
            displayText={province.selected.label}
            options={province.options}
            sheetTitle={reviewStrings.provinces.sheetTitle}
            accessibilityLabel={reviewStrings.provinces.a11y(province.selected.label)}
            leadingIcon="pin"
            height={45}
            onChange={province.choose}
            style={styles.fProvince}
          />
          <FilterSelect<AdminPeriod>
            testID="AdminSummary.filter.period"
            value={period}
            displayText={s.periods[period]}
            options={periods}
            sheetTitle={s.periodSheetTitle}
            accessibilityLabel={s.periodA11y}
            leadingIcon="calendarGrid"
            height={45}
            onChange={setPeriod}
            style={styles.fPeriod}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Screen testID="AdminSummary" header={header} paddingX={11} refreshing={summary.isRefreshing} onRefresh={ready ? () => { void summary.refetch(); void activity.refetch(); } : undefined} contentContainerStyle={styles.content}>
        {body}
      </Screen>
      <BottomSheet
        visible={info}
        onClose={() => setInfo(false)}
        title={s.infoTitle}
        testID="AdminSummary.info"
        footer={<Button testID="AdminSummary.info.close" label={s.infoClose} chevron={false} onPress={() => setInfo(false)} />}
      >
        {activity.data !== undefined ? (
          <>
            <Text variant="body" color="body" size={16.5} lineHeight={22}>{activityInfoBody(activity.data)}</Text>
            <Text variant="body" color="deep" size={16} style={styles.note}>{s.infoTotal(activity.data.totalVehicles)}</Text>
          </>
        ) : null}
      </BottomSheet>
      <StaffAccessSheet visible={gate.sheetOpen} onClose={gate.closeSheet} me={access.me} loading={access.query.isLoading || access.query.isIdle} error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 10, paddingBottom: 16 },
  filters: { flexDirection: "row", paddingHorizontal: 11, paddingTop: 10, gap: 16, marginBottom: 6 },
  fProvince: { flex: 159.5 },
  fPeriod: { flex: 197 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  cell: { width: "50%", padding: 4 },
  note: { marginTop: 8, paddingHorizontal: 4 },
  mapBox: { marginTop: 4, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", overflow: "hidden", paddingBottom: 10 },
  mapFlush: { borderWidth: 0, borderRadius: 0 },
  legend: { paddingHorizontal: 14, marginTop: 9 },
  flex: { flex: 1 },
  mapTitle: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
});
