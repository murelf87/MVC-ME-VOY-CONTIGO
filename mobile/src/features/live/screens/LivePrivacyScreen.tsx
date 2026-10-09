/**
 * «Privacidad del viaje en vivo»: qué ven los demás pasajeros de ti en «En el coche» (`GET/PUT /v1/me/live-privacy`) y qué
 * muestran los enlaces de «Compartir viaje». Cada cambio se guarda al momento y se confirma; si falla, el interruptor
 * vuelve a su valor real y se explica por qué. Estados: cargando · error · sin cambios · guardando · guardado · error al guardar.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import { formatDateTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { Banner, Card, Screen, ScreenHeader, Skeleton, Switch, Text, showToast } from "@/ui";
import { LoadError } from "../components/LoadError";
import { useLivePrivacy, useSaveLivePrivacy } from "../hooks/useLivePrivacy";
import { liveStrings } from "../strings";

const T = liveStrings.privacy;
const SIDE = 14;

export function LivePrivacyScreen({ navigation }: AppScreenProps<"LivePrivacy">): React.JSX.Element {
  const query = useLivePrivacy();
  const save = useSaveLivePrivacy();
  const header = <ScreenHeader title={T.title} testID="LivePrivacy.header" />;

  if (query.data === undefined) {
    return (
      <Screen testID="LivePrivacy" paddingX={SIDE} header={header}>
        <View style={styles.block}>
          {query.error ? (
            <LoadError error={query.error} onRetry={() => void query.refetch()} fallbackLabel={liveStrings.common.back} onFallback={() => navigation.goBack()} testID="LivePrivacy.error" />
          ) : (
            <View testID="LivePrivacy.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
              <Skeleton height={110} radius={14} />
              <Skeleton height={90} radius={14} style={styles.gap} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  const value = save.isPending && save.variables ? save.variables.showProfileToCoPassengers : query.data.showProfileToCoPassengers;
  const change = async (next: boolean): Promise<void> => {
    const saved = await save.mutate({ showProfileToCoPassengers: next });
    if (saved) showToast({ kind: "success", message: T.saved });
  };

  return (
    <Screen testID="LivePrivacy" paddingX={SIDE} header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <View style={styles.block}>
        <Text variant="body" color="strong" size={17} lineHeight={23}>{T.intro}</Text>

        <Card tone="blue" padding={14} style={styles.gap}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text variant="rowTitle" color="heading" size={17.5}>{T.profileTitle}</Text>
              <Text testID="LivePrivacy.profileHelp" variant="body" color="strong" size={15} lineHeight={20} style={styles.line}>{value ? T.profileOn : T.profileOff}</Text>
            </View>
            <Switch testID="LivePrivacy.profile" value={value} disabled={save.isPending} onValueChange={(next) => void change(next)} tone="blue" accessibilityLabel={T.profileTitle} />
          </View>
          <Text variant="body" color="muted" size={14} lineHeight={19} style={styles.line}>{T.sharedAlways}</Text>
          {query.data.updatedAt !== null ? <Text variant="body" color="muted" size={14} style={styles.line}>{T.updatedAt(formatDateTime(query.data.updatedAt))}</Text> : null}
        </Card>

        {save.error ? <Banner testID="LivePrivacy.saveError" kind="error" title={T.saveFailed} message={describeError(save.error).message} style={styles.gap} /> : null}

        <Card padding={14} style={styles.gap}>
          <Text variant="rowTitle" color="heading" size={17}>{T.shareTitle}</Text>
          <Text variant="body" color="strong" size={15} lineHeight={20} style={styles.line}>{T.shareNote}</Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 14 },
  line: { marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
});
