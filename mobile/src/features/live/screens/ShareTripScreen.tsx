/**
 * «Compartir viaje» (desde «En el coche»). Sin lámina propia: se diseña con el lenguaje de la 23 (tarjetas azules, filas)
 * y el de la 29 (interruptores). Crea un enlace privado y revocable (`POST /v1/bookings/{id}/share`): el token solo se
 * muestra una vez; el servidor guarda su hash. Quien lo abre ve nombre de pila, coche, ruta, llegada y una zona de ~1 km:
 * nunca teléfono ni posición exacta; la matrícula solo si se incluye. Estados: cargando · error · sin enlace · creando ·
 * creado (copiar / enviar) · activo sin token (crear nuevo) · retirar con confirmación · no permitido (409).
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { LiveShareCreated } from "@/api/types";
import { formatDateTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { copyToClipboard, shareContent } from "@/platform";
import { Banner, Button, Card, ConfirmDialog, ListRow, Screen, ScreenHeader, SectionHeader, Segmented, Skeleton, Switch, Text, showToast } from "@/ui";
import { LoadError } from "../components/LoadError";
import { useCreateShare, useRevokeShare, useShareStatus } from "../hooks/useShare";
import { liveStrings } from "../strings";

const T = liveStrings.share;
const SIDE = 14;
type Duration = "60" | "360" | "1440";
const DURATIONS: readonly { value: Duration; label: string }[] = [
  { value: "60", label: T.durations["60"] },
  { value: "360", label: T.durations["360"] },
  { value: "1440", label: T.durations["1440"] },
];

export function ShareTripScreen({ navigation, route }: AppScreenProps<"ShareTrip">): React.JSX.Element {
  const { bookingId } = route.params;
  const status = useShareStatus(bookingId);
  const create = useCreateShare(bookingId);
  const revoke = useRevokeShare(bookingId);
  const [includePlate, setIncludePlate] = useState(false);
  const [duration, setDuration] = useState<Duration>("360");
  const [created, setCreated] = useState<LiveShareCreated | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const header = <ScreenHeader title={T.title} testID="ShareTrip.header" />;

  if (status.data === undefined) {
    return (
      <Screen testID="ShareTrip" paddingX={SIDE} header={header}>
        <View style={styles.block}>
          {status.error ? (
            <LoadError error={status.error} onRetry={() => void status.refetch()} fallbackLabel={liveStrings.common.back} onFallback={() => navigation.goBack()} testID="ShareTrip.error" />
          ) : (
            <View testID="ShareTrip.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
              <Skeleton height={80} radius={14} />
              <Skeleton height={150} radius={14} style={styles.gap} />
              <Skeleton height={56} radius={14} style={styles.gap} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  const active = status.data.share;
  const link = created?.url ?? null;

  const make = async (): Promise<void> => {
    const result = await create.mutate({ includePlate, expiresInMinutes: Number(duration) });
    if (result) setCreated(result);
  };
  const copyLink = async (): Promise<void> => {
    if (link === null) return;
    const ok = await copyToClipboard(link);
    showToast({ kind: ok ? "success" : "error", message: ok ? T.copied : T.copyFailed });
  };
  const sendLink = async (): Promise<void> => {
    if (link === null || created === null) return;
    const outcome = await shareContent({ title: T.shareTitle, message: T.shareMessage.replace("{date}", formatDateTime(created.expiresAt)), url: link });
    if (outcome === "unavailable") showToast({ kind: "warning", message: T.shareUnavailable });
  };
  const doRevoke = async (): Promise<void> => {
    const result = await revoke.mutate(undefined);
    setConfirmRevoke(false);
    if (result !== undefined || revoke.error === null) {
      setCreated(null);
      showToast({ kind: "success", message: T.revoked });
    }
  };

  return (
    <Screen testID="ShareTrip" paddingX={SIDE} header={header} refreshing={status.isRefreshing} onRefresh={() => void status.refetch()}>
      <View style={styles.block}>
        <Text variant="body" color="strong" size={17} lineHeight={23}>{T.intro}</Text>

        {created !== null ? (
          <Card tone="green" padding={14} style={styles.gap} testID="ShareTrip.created">
            <Text variant="rowTitle" color="heading" size={18}>{T.createdTitle}</Text>
            {link !== null ? (
              <>
                <Text testID="ShareTrip.url" variant="body" color="deep" size={15} selectable style={styles.url}>{link}</Text>
                <Button testID="ShareTrip.copy" label={T.copy} leadingIcon="copy" chevron={false} onPress={() => void copyLink()} style={styles.gapSm} />
                <Button testID="ShareTrip.send" label={T.send} variant="outline" leadingIcon="share" chevron={false} onPress={() => void sendLink()} style={styles.gapSm} />
              </>
            ) : (
              <Banner testID="ShareTrip.noUrl" kind="warning" size="sm" title={T.noPublicUrl} style={styles.gapSm} />
            )}
            <Text variant="body" color="strong" size={14.5} lineHeight={19} style={styles.gapSm}>{T.createdNote}</Text>
          </Card>
        ) : null}

        {active !== null && created === null ? (
          <Card tone="blue" padding={14} style={styles.gap} testID="ShareTrip.active">
            <Text variant="rowTitle" color="heading" size={18}>{T.activeTitle}</Text>
            <Text variant="body" color="strong" size={15.5} style={styles.line}>{T.expires(formatDateTime(active.expiresAt))}</Text>
            <Text variant="body" color="strong" size={15.5}>{T.views(active.viewCount)}{active.lastViewedAt !== null ? ` · ${T.lastViewed(formatDateTime(active.lastViewedAt))}` : ""}</Text>
            <Text variant="body" color="strong" size={15.5}>{active.includePlate ? T.plateIncluded : T.plateExcluded}</Text>
            <Text variant="body" color="muted" size={14} lineHeight={19} style={styles.line}>{T.noTokenNote}</Text>
          </Card>
        ) : null}

        {created === null ? (
          <>
            <SectionHeader title={T.seesTitle} style={styles.section} />
            <Card padding={12}>
              {T.sees.map((line) => (
                <Text key={line} variant="body" color="strong" size={15.5} lineHeight={21}>{`✓  ${line}`}</Text>
              ))}
            </Card>
            <SectionHeader title={T.notSeesTitle} style={styles.section} />
            <Card padding={12}>
              {T.notSees.map((line) => (
                <Text key={line} variant="body" color="strong" size={15.5} lineHeight={21}>{`✕  ${line}`}</Text>
              ))}
            </Card>

            <View style={[styles.plateRow, styles.section]}>
              <View style={styles.flex}>
                <Text variant="rowTitle" color="heading" size={17}>{T.plateLabel}</Text>
                <Text variant="body" color="muted" size={14.5}>{T.plateHint}</Text>
              </View>
              <Switch testID="ShareTrip.plate" value={includePlate} onValueChange={setIncludePlate} accessibilityLabel={T.plateLabel} />
            </View>

            <SectionHeader title={T.durationTitle} style={styles.section} />
            <Segmented<Duration> testID="ShareTrip.duration" options={DURATIONS} value={duration} onChange={setDuration} accessibilityLabel={T.durationTitle} />

            {create.error ? <Banner testID="ShareTrip.createError" kind="error" title={T.createFailed} message={describeError(create.error).message} style={styles.gap} /> : null}
            <Button testID="ShareTrip.create" label={create.isPending ? T.creating : active !== null ? T.createNew : T.create} loading={create.isPending} onPress={() => void make()} style={styles.gap} />
          </>
        ) : (
          <Button testID="ShareTrip.done" label={liveStrings.common.done} variant="outline" chevron={false} onPress={() => navigation.goBack()} style={styles.gap} />
        )}

        {active !== null ? (
          <>
            {revoke.error ? <Banner testID="ShareTrip.revokeError" kind="error" title={T.revokeFailed} message={describeError(revoke.error).message} style={styles.gap} /> : null}
            <Button testID="ShareTrip.revoke" label={T.revoke} variant="dangerOutline" leadingIcon="close" chevron={false} onPress={() => { revoke.reset(); setConfirmRevoke(true); }} style={styles.gap} />
          </>
        ) : null}

        <ListRow testID="ShareTrip.privacy" title={T.privacyLink} tone="none" titleSize={16} onPress={() => navigation.navigate("LivePrivacy")} style={styles.gap} />
      </View>

      <ConfirmDialog
        visible={confirmRevoke}
        destructive
        loading={revoke.isPending}
        title={T.revokeTitle}
        message={T.revokeMessage}
        confirmLabel={T.revokeConfirm}
        cancelLabel={T.revokeBack}
        onConfirm={() => void doRevoke()}
        onCancel={() => setConfirmRevoke(false)}
        testID="ShareTrip.revokeDialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 14 },
  gapSm: { marginTop: 10 },
  line: { marginTop: 6 },
  section: { marginTop: 18 },
  url: { marginTop: 8 },
  plateRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
