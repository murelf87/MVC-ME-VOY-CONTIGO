/**
 * «Cancelar el viaje» (conductor). Sin lámina propia: usa el lenguaje de la 28 «Motivo de la cancelación» (filas de
 * opción única, comentario opcional, aviso de consecuencias). Con `bookingId` cancela UNA reserva (`driver-cancel`);
 * sin él cancela el viaje entero (`POST /v1/me/trips/{id}/cancel`, propuesto). Las devoluciones NUNCA se prometen:
 * el servidor abre una revisión.
 */
import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { DriverCancellationReason } from "@/api/types";
import type { AppScreenProps } from "@/navigation";
import { Banner, Button, Card, ConfirmDialog, RadioRow, Screen, ScreenHeader, SectionHeader, TextArea, Text } from "@/ui";
import { OpsErrorCard } from "../components/OpsErrorCard";
import { describeOps } from "../hooks/describe";
import { useCancelTrip, useDriverCancelBooking } from "../hooks/useCancelTrip";
import { useDriverConsole } from "../hooks/useDriverConsole";
import { opsStrings } from "../strings";
import { tripStrings } from "../stringsTrip";

const T = tripStrings.cancel;
const SCREEN_X = 14;
const REASONS: readonly DriverCancellationReason[] = ["schedule_change", "vehicle_issue", "emergency", "passenger_issue", "other"];

interface Done {
  alreadyCancelled: boolean;
  message: string;
  refundsOpen: number;
}

export function DriverCancelTripScreen({ navigation, route }: AppScreenProps<"DriverCancelTrip">): React.JSX.Element {
  const tripId = route.params?.tripId ?? "";
  const bookingId = route.params?.bookingId;
  const single = bookingId !== undefined;
  const consoleQuery = useDriverConsole(tripId);
  const tripCancel = useCancelTrip(tripId);
  const bookingCancel = useDriverCancelBooking(bookingId ?? "");
  const active = single ? bookingCancel : tripCancel;

  const [reason, setReason] = useState<DriverCancellationReason | null>(null);
  const [note, setNote] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [dialog, setDialog] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const status = consoleQuery.data?.status;
  const blocked = status !== undefined && status !== "published" && !single;
  const confirmed = consoleQuery.data?.counts.total ?? 0;
  const error = useMemo(() => {
    if (!active.error) return null;
    const base = describeOps(active.error);
    // El servidor real aún no implementa «cancelar el viaje entero»: una ruta inexistente (404/405 sin código de dominio)
    // no es «viaje no encontrado». Se dice tal cual y se manda a cancelar reserva a reserva.
    const api = active.error as { kind?: unknown; status?: unknown; code?: unknown };
    const routeMissing = !single && api.kind === "api" && (api.status === 404 || api.status === 405) && api.code !== "TRIP_NOT_FOUND";
    return routeMissing ? { ...base, kind: "unknown" as const, title: T.unavailableTitle, message: T.unavailableMessage, retryable: false, action: "none" as const, actionLabel: null } : base;
  }, [active.error, single]);

  const toTrips = (): void => navigation.navigate("MyTrips");
  const title = single ? T.titleBooking : T.title;

  const submit = async (): Promise<void> => {
    if (reason === null) return;
    const body = { reason, ...(note.trim() !== "" ? { note: note.trim() } : {}) };
    if (single) {
      const result = await bookingCancel.mutate(body);
      setDialog(false);
      if (result) {
        setDone({ alreadyCancelled: result.alreadyCancelled, message: T.doneMessageBooking, refundsOpen: result.refund ? 1 : 0 });
      }
    } else {
      const result = await tripCancel.mutate(body);
      setDialog(false);
      if (result) {
        setDone({
          alreadyCancelled: result.alreadyCancelled,
          message: T.doneMessage(result.bookings.length, result.closedRequests),
          refundsOpen: result.bookings.filter((b) => b.refund !== null).length,
        });
      }
    }
  };

  const onSubmit = (): void => {
    if (reason === null) {
      setReasonError(T.reasonRequired);
      return;
    }
    active.reset();
    setDialog(true);
  };

  const header = <ScreenHeader title={title} testID="DriverCancelTrip.header" />;

  if (done !== null) {
    return (
      <Screen testID="DriverCancelTrip" paddingX={SCREEN_X} header={header} footer={<View style={styles.footer}><Button testID="DriverCancelTrip.toTrips" label={T.toTrips} onPress={toTrips} /></View>}>
        <View style={styles.block}>
          <Banner testID="DriverCancelTrip.done" kind="success" title={single ? T.doneTitleBooking : T.doneTitle} message={done.message} />
          {done.alreadyCancelled ? <Text variant="body" color="muted" size={15} style={styles.note}>{T.already}</Text> : null}
          <SectionHeader title={T.refundsTitle} style={styles.section} />
          <Card tone="blue" padding={14}>
            <Text variant="rowTitle" color="heading" size={17}>{done.refundsOpen > 0 ? T.refundReview : T.refundNone}</Text>
            {done.refundsOpen > 0 ? <Text variant="body" color="muted" size={15} style={styles.note}>{T.refundOpened}</Text> : null}
          </Card>
        </View>
      </Screen>
    );
  }

  if (blocked) {
    return (
      <Screen testID="DriverCancelTrip" paddingX={SCREEN_X} header={header} footer={<View style={styles.footer}><Button testID="DriverCancelTrip.toTrips" label={T.toTrips} variant="outline" chevron={false} onPress={toTrips} /></View>}>
        <View style={styles.block}>
          <Banner testID="DriverCancelTrip.blocked" kind="warning" title={T.notCancellableTitle} message={status === "active" ? opsStrings.errors.tripAlreadyStarted.message : T.notCancellableMessage} />
        </View>
      </Screen>
    );
  }

  const footer = (
    <View style={styles.footer}>
      <Button testID="DriverCancelTrip.submit" label={single ? T.submitBooking : T.submit} variant="danger" loading={active.isPending} onPress={onSubmit} />
      <Button testID="DriverCancelTrip.keep" label={T.keep} variant="outline" chevron={false} onPress={() => navigation.goBack()} style={styles.gap} />
    </View>
  );

  return (
    <Screen testID="DriverCancelTrip" paddingX={SCREEN_X} header={header} footer={footer}>
      <View style={styles.block}>
        <Text variant="body" color="strong" size={17} lineHeight={23}>{single ? T.introBooking : T.intro}</Text>

        <SectionHeader title={T.reasonTitle} style={styles.section} />
        {REASONS.map((value) => (
          <RadioRow
            key={value}
            testID={`DriverCancelTrip.reason.${value}`}
            label={T.reasons[value]}
            selected={reason === value}
            onSelect={() => {
              setReason(value);
              setReasonError(undefined);
            }}
            style={styles.radio}
          />
        ))}
        {reasonError ? <Text testID="DriverCancelTrip.reasonError" variant="body" color="error" size={15} style={styles.note}>{reasonError}</Text> : null}

        <SectionHeader title={T.noteLabel} style={styles.section} />
        <TextArea testID="DriverCancelTrip.note" value={note} onChangeText={setNote} placeholder={T.notePlaceholder} maxLength={500} minHeight={96} />

        <Banner testID="DriverCancelTrip.warning" kind="warning" icon="exclaim" title={T.warningTitle} message={single ? T.warningBooking : T.warningTrip(confirmed)} style={styles.gap} />

        {error ? <OpsErrorCard testID="DriverCancelTrip.error" error={error} onAction={() => void submit()} /> : null}
      </View>

      <ConfirmDialog
        visible={dialog}
        destructive
        loading={active.isPending}
        title={single ? T.dialogTitleBooking : T.dialogTitle}
        message={T.dialogMessage}
        confirmLabel={T.confirm}
        cancelLabel={T.back}
        onConfirm={() => void submit()}
        onCancel={() => setDialog(false)}
        testID="DriverCancelTrip.dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 12 },
  section: { marginTop: 18 },
  radio: { marginTop: 8 },
  note: { marginTop: 6 },
  footer: { paddingHorizontal: SCREEN_X, paddingBottom: 8 },
});
