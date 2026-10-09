/**
 * «Viaje terminado» (conductor). Sin lámina propia: se diseña con el lenguaje de la 24 «Viaje terminado» (franja verde,
 * resumen, siguientes pasos). Todo sale de la consola del servidor: quién fue recogido y quién no se presentó. No muestra
 * importes: la tarifa aún no está activada.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { formatTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { Avatar, Banner, Button, Card, Screen, ScreenHeader, SectionHeader, Skeleton, StatTile, StatusPill, Text } from "@/ui";
import { OpsErrorCard } from "../components/OpsErrorCard";
import { describeOps } from "../hooks/describe";
import { useDriverConsole } from "../hooks/useDriverConsole";
import { opsStrings } from "../strings";
import { tripStrings } from "../stringsTrip";

const T = tripStrings.finished;
const SCREEN_X = 14;

export function DriverTripFinishedScreen({ navigation, route }: AppScreenProps<"DriverTripFinished">): React.JSX.Element {
  const tripId = route.params?.tripId ?? "";
  const query = useDriverConsole(tripId);
  const data = query.data;
  const header = <ScreenHeader title={T.title} testID="DriverTripFinished.header" />;
  const toTrips = (): void => navigation.navigate("MyTrips");

  if (data === undefined) {
    if (query.error) {
      return (
        <Screen testID="DriverTripFinished" paddingX={SCREEN_X} header={header}>
          <View style={styles.block}>
            <OpsErrorCard error={describeOps(query.error)} onAction={() => void query.refetch()} testID="DriverTripFinished.error" />
            <Button testID="DriverTripFinished.toTrips" label={T.toTrips} variant="outline" chevron={false} onPress={toTrips} style={styles.gap} />
          </View>
        </Screen>
      );
    }
    return (
      <Screen testID="DriverTripFinished" paddingX={SCREEN_X} header={header}>
        <View style={styles.block} testID="DriverTripFinished.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
          <Skeleton height={90} radius={14} />
          <Skeleton height={90} radius={14} style={styles.gap} />
        </View>
      </Screen>
    );
  }

  const done = data.status === "completed";
  const noShow = data.passengers.filter((p) => p.bookingStatus === "no_show").length;
  const picked = data.passengers.filter((p) => p.pickedUp).length;

  const footer = (
    <View style={styles.footer}>
      <Button testID="DriverTripFinished.publish" label={T.publishAnother} leadingIcon="route" onPress={() => navigation.navigate("PublishRoute")} />
      <Button testID="DriverTripFinished.toTrips" label={T.toTrips} variant="outline" chevron={false} onPress={toTrips} style={styles.gap} />
    </View>
  );

  return (
    <Screen testID="DriverTripFinished" paddingX={SCREEN_X} header={header} footer={footer}>
      <View style={styles.block}>
        <Banner
          testID="DriverTripFinished.hero"
          kind={done ? "success" : "warning"}
          icon={done ? "checkCircle" : "exclaim"}
          title={done ? T.heroTitle : data.status === "cancelled" ? opsStrings.console.banner.cancelledTitle : T.notYet}
          message={done ? T.heroMessage(data.completedAt ? formatTime(data.completedAt) : null) : data.status === "cancelled" ? opsStrings.console.banner.cancelledMessage : T.notYetMessage}
        />
        {done ? (
          <>
            <View style={styles.stats}>
              <StatTile testID="DriverTripFinished.picked" icon="checkCircle" value={String(picked)} label={T.pickedUp} />
              <StatTile testID="DriverTripFinished.noShow" icon="exclaim" value={String(noShow)} label={T.noShow} />
            </View>
            <SectionHeader title={T.passengersTitle} style={styles.section} />
            {data.passengers.length === 0 ? <Text variant="body" color="muted" size={16}>{T.nothing}</Text> : null}
            {data.passengers.map((p) => (
              <Card key={p.bookingId} tone="white" padding={12} style={styles.rowGap} testID={`DriverTripFinished.passenger.${p.bookingId}`}>
                <View style={styles.row}>
                  <Avatar source={p.passenger.photoUrl} name={p.passenger.displayName} size={44} />
                  <View style={styles.flex}>
                    <Text variant="rowTitle" color="heading" size={17} numberOfLines={1}>{p.passenger.firstName}</Text>
                    <Text variant="body" color="muted" size={14.5} numberOfLines={1}>{p.bookingStatus === "no_show" ? T.noShowLine : p.pickedUp ? T.completedLine : T.other}</Text>
                  </View>
                  <StatusPill size="sm" label={p.bookingStatus === "no_show" ? opsStrings.console.passengers.status.noShow : p.pickedUp ? opsStrings.console.passengers.status.completed : opsStrings.console.passengers.status.waiting} tone={p.bookingStatus === "no_show" ? "red" : p.pickedUp ? "green" : "gray"} />
                </View>
              </Card>
            ))}
            <Button testID="DriverTripFinished.requests" label={T.requests} variant="outline" leadingIcon="opsInbox" onPress={() => navigation.navigate("DriverRequests")} style={styles.gap} />
          </>
        ) : (
          <Button testID="DriverTripFinished.console" label={opsStrings.console.actions.manage} variant="outline" chevron={false} onPress={() => navigation.navigate("DriverConsole", { tripId })} style={styles.gap} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 12 },
  rowGap: { marginTop: 8 },
  section: { marginTop: 18 },
  stats: { flexDirection: "row", gap: 12, marginTop: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  footer: { paddingHorizontal: SCREEN_X, paddingBottom: 8 },
});
