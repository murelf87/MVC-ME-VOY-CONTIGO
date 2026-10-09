/**
 * «Mis incidencias»: las que la persona ha reportado como pasajera o como conductora, la más reciente primero. Sin lámina
 * propia: filas-tarjeta de la 29 con la píldora de estado de la 25. Estados: cargando · error (reintentar) · sin
 * incidencias (con salida) · lista · recargar tirando hacia abajo.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { LiveIncidentReport } from "@/api/types";
import { formatDateTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { EmptyState, ListRow, Screen, ScreenHeader, Skeleton, StatusPill, type StatusTone } from "@/ui";
import { LoadError } from "../components/LoadError";
import { useMyIncidents } from "../hooks/useIncidents";
import { liveStrings } from "../strings";

const T = liveStrings.incidents;
const SIDE = 14;

const TONE: Record<LiveIncidentReport["status"], StatusTone> = { open: "amber", in_review: "blue", resolved: "green", dismissed: "gray" };

export function IncidentReportsScreen({ navigation }: AppScreenProps<"IncidentReports">): React.JSX.Element {
  const query = useMyIncidents();
  const items = query.data?.items ?? [];
  const header = <ScreenHeader title={T.title} testID="IncidentReports.header" />;

  if (query.data === undefined) {
    return (
      <Screen testID="IncidentReports" paddingX={SIDE} header={header}>
        <View style={styles.block}>
          {query.error ? (
            <LoadError error={query.error} onRetry={() => void query.refetch()} testID="IncidentReports.error" />
          ) : (
            <View testID="IncidentReports.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
              <Skeleton height={76} radius={14} />
              <Skeleton height={76} radius={14} style={styles.gap} />
              <Skeleton height={76} radius={14} style={styles.gap} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen testID="IncidentReports" paddingX={SIDE} header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <View style={styles.block}>
        {items.length === 0 ? (
          <EmptyState testID="IncidentReports.empty" icon="chat" title={T.empty} message={T.emptyMessage} actionLabel={T.backToMyTrips} onAction={() => navigation.goBack()} variant="plain" />
        ) : (
          items.map((item, index) => (
            <ListRow
              key={item.id}
              testID={`IncidentReports.item.${item.id}`}
              title={liveStrings.report.categories[item.category]}
              subtitle={`${T.sentOn(formatDateTime(item.createdAt))}${item.attachments.length > 0 ? ` · ${T.photos(item.attachments.length)}` : ""}`}
              trailing={<StatusPill label={T.status[item.status]} tone={TONE[item.status]} size="sm" />}
              titleSize={17}
              onPress={() => navigation.navigate("IncidentDetail", { reportId: item.id })}
              accessibilityLabel={`${liveStrings.report.categories[item.category]}. ${T.status[item.status]}. ${T.sentOn(formatDateTime(item.createdAt))}`}
              style={index === 0 ? undefined : styles.gap}
            />
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 10 },
});
