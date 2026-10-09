import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { dateFieldLabel } from "@/features/search/browse/logic/schedule";
import { useAppNavigation, useAppRoute } from "@/navigation";
import { colors, radii } from "@/theme";
import { Button, LargeButton, Screen, Text } from "@/ui";
import { DriverHeader } from "../components/DriverHeader";
import { DRIVER_SIDE, DRIVER_TOP_GAP } from "../components/metrics";
import { publishStrings } from "../strings";

const copy = publishStrings.published;

/**
 * «Ruta publicada»: confirmación tras «Guardar ruta». Resume lo que se ha publicado (lo devuelve el servidor, no se
 * inventa) y lleva a las solicitudes, al viaje o a publicar otra ruta. Con los viajes puntuales dice el día; con la serie
 * diaria, cuántos viajes se han creado (el servidor sigue ampliando).
 */
export function RoutePublishedScreen(): React.JSX.Element {
  const navigation = useAppNavigation();
  const { params } = useAppRoute("RoutePublished");
  const summary = params?.summary;

  const rows: { label: string; value: string }[] = [];
  if (summary !== undefined) {
    rows.push({ label: copy.routeLabel, value: `${summary.origin} → ${summary.destination}` });
    rows.push({
      label: copy.scheduleLabel,
      value: summary.returnAt !== undefined ? `${summary.outbound} · ${summary.returnAt}` : summary.outbound,
    });
    rows.push({ label: copy.seatsLabel, value: String(summary.seats) });
    rows.push({ label: copy.frequencyLabel, value: summary.frequency === "one_off" ? publishStrings.routeForm.oneOff : publishStrings.routeForm.daily });
    if (summary.km !== undefined) rows.push({ label: copy.distanceLabel, value: summary.km });
  }
  const intro =
    summary === undefined
      ? ""
      : summary.frequency === "one_off"
        ? copy.oneOff(summary.firstDeparture !== undefined ? dateFieldLabel(summary.firstDeparture.slice(0, 10), new Date()) : "día elegido")
        : copy.daily(summary.count);

  return (
    <Screen
      header={<DriverHeader title={copy.title} hideBack testID="RoutePublished.header" />}
      paddingX={DRIVER_SIDE}
      contentContainerStyle={{ paddingTop: DRIVER_TOP_GAP }}
      testID="RoutePublished"
      footer={
        <View>
          <LargeButton label={copy.openRequests} onPress={() => navigation.navigate("DriverRequests")} size="compact" testID="RoutePublished.requests" />
          <Button label={copy.publishAnother} variant="ghost" onPress={() => navigation.popTo("PublishRoute", { draftId: undefined })} testID="RoutePublished.another" />
          <Button label={copy.home} variant="ghost" chevron={false} onPress={() => navigation.navigate("MapHome")} testID="RoutePublished.home" />
        </View>
      }
    >
      <View style={styles.hero} accessibilityRole="summary">
        <View style={styles.disc}>
          <Icon name="checkCircle" size={44} color={colors.success.solid} />
        </View>
        <Text variant="heading" color="deep" size={26} lineHeight={31} align="center" accessibilityRole="header" testID="RoutePublished.heading">
          {copy.heading}
        </Text>
        {intro !== "" ? (
          <Text variant="body" color="heading" size={17.5} lineHeight={23} align="center" style={styles.intro}>
            {intro}
          </Text>
        ) : null}
      </View>
      {rows.length > 0 ? (
        <View style={styles.card} testID="RoutePublished.summary">
          {rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text variant="caption" color="muted" size={15} style={styles.rowLabel}>{row.label}</Text>
              <Text variant="rowTitle" color="strong" size={17.5} lineHeight={22} style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {params?.tripId !== undefined ? (
        <Button label={copy.seeTrip} variant="outline" chevron={false} onPress={() => navigation.navigate("DriverTripManage", { tripId: params?.tripId as string })} testID="RoutePublished.seeTrip" style={styles.seeTrip} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingVertical: 18 },
  disc: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.success.bg, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  intro: { marginTop: 8, paddingHorizontal: 12 },
  card: { backgroundColor: colors.bg.tint, borderRadius: radii.lg, padding: 14 },
  row: { flexDirection: "row", paddingVertical: 6 },
  rowLabel: { width: 96 },
  rowValue: { flex: 1 },
  seeTrip: { marginTop: 12 },
});
