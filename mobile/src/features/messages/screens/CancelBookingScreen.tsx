/**
 * 28 · Cancelar reserva. Tarjeta de la reserva (foto de quien conduce, ruta, día, hora, plazas, «Ana (Conductora)»),
 * «Motivo de la cancelación» (cuatro filas de opción única; «Otro motivo» admite una nota), «Detalle del reembolso
 * (propuesta)» con «Aporte del viaje» y «Gestión de la plataforma · Por definir», el aviso legal, «Mantener reserva» y
 * «Confirmar cancelación» (pide confirmación).
 *
 * Honestidad: sin política de cancelación aprobada TODO lo derivado es «Por definir» y es una propuesta que revisa
 * Administración, nunca una promesa de devolución. Si el servidor dice que no se puede cancelar (ya cancelada, ya no
 * cancelable, viaje empezado) se explica y se ofrece ver la reserva. `Idempotency-Key`: reintentar no cancela dos veces.
 * Estados: cargando · no existe · error · no cancelable · formulario · cancelando · error al cancelar · cancelada.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { CancellationPreview, PassengerCancellationReason } from "@/api/types";
import { PASSENGER_CANCELLATION_REASON_LABELS } from "@/api/types";
import { MvcLogo } from "@/brand";
import { formatDayRelative, formatMoney, formatTime } from "@/i18n";
import { Icon } from "@/icons";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Avatar, Banner, BottomSheet, Button, ConfirmDialog, ErrorStateCard, RadioRow, Screen, ScreenHeader, SectionHeader, Skeleton, Text, TextArea } from "@/ui";
import { rememberCancelOutcome, useCancelBooking, useCancellationPreview } from "../hooks/useCancellation";
import { messagesStrings } from "../strings";

const copy = messagesStrings.cancel;
const SIDE = 14;

function InfoButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }): React.JSX.Element {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={onPress}>
      <Icon name="infoOutline" size={26} color={colors.primary} />
    </Pressable>
  );
}

function Summary({ preview, onOpen }: { preview: CancellationPreview; onOpen: () => void }): React.JSX.Element {
  const { booking } = preview;
  const route = `${booking.trip.originLabel ?? "—"} → ${booking.trip.destinationLabel ?? "—"}`;
  const departure = booking.trip.departureAt;
  const when = departure === null ? "" : `${formatDayRelative(departure)} · ${formatTime(departure)}`;
  const line = [when, copy.seats(booking.seats)].filter((part) => part !== "").join(" · ");
  return (
    <Pressable
      testID="CancelBooking.summary"
      accessibilityRole="button"
      accessibilityLabel={copy.summaryA11y(route, line, booking.driver.firstName)}
      onPress={onOpen}
      style={({ pressed }) => [styles.summary, pressed ? { opacity: 0.9 } : null]}
    >
      <Avatar source={booking.driver.photoUrl} name={booking.driver.displayName} size={64} />
      <View style={styles.flex}>
        <Text variant="titleSm" color="heading" size={17.5} lineHeight={21} numberOfLines={2}>{route}</Text>
        <Text variant="body" color="body" size={16} lineHeight={20} style={styles.line}>{line}</Text>
        <View style={styles.driver}>
          <Icon name="car" size={22} color={colors.primary} />
          <Text variant="body" color="deep" size={16}>{copy.driverRole(booking.driver.firstName)}</Text>
        </View>
      </View>
      <Icon name="chevronRight" size={20} color={colors.primary} />
    </Pressable>
  );
}

export function CancelBookingScreen({ navigation, route }: AppScreenProps<"CancelBooking">): React.JSX.Element {
  const bookingId = route.params.bookingId;
  const query = useCancellationPreview(bookingId);
  const cancel = useCancelBooking(bookingId);
  const [reason, setReason] = React.useState<PassengerCancellationReason>("no_longer_needed");
  const [note, setNote] = React.useState("");
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const header = <ScreenHeader title={copy.title} testID="CancelBooking.header" />;
  const preview = query.data;

  const seeBooking = (): void => navigation.navigate("BookingDetail", { bookingId });

  if (preview === undefined) {
    const described = query.error ? describeError(query.error) : null;
    return (
      <Screen testID="CancelBooking" paddingX={SIDE} header={header}>
        <View style={styles.block}>
          {described === null ? (
            <View testID="CancelBooking.loading" accessible accessibilityLabel={messagesStrings.common.updating} accessibilityState={{ busy: true }}>
              <Skeleton height={112} radius={16} />
              <Skeleton height={230} radius={16} style={styles.gap} />
              <Skeleton height={150} radius={16} style={styles.gap} />
            </View>
          ) : described.status === 404 ? (
            <ErrorStateCard testID="CancelBooking.notFound" tone="amber" icon="alertCircle" title={copy.notFoundTitle} message={copy.notFoundMessage} actionLabel={messagesStrings.common.back} onAction={() => navigation.goBack()} />
          ) : (
            <ErrorStateCard testID="CancelBooking.error" tone="red" icon="alertCircle" title={copy.loadErrorTitle} message={described.message} actionLabel={messagesStrings.common.retry} onAction={() => void query.refetch()} />
          )}
        </View>
      </Screen>
    );
  }

  const blocked = preview.blocked;
  const driverName = preview.booking.driver.firstName;
  const lineTrip = preview.lines.find((l) => l.key === "trip_contribution");
  const lineFee = preview.lines.find((l) => l.key === "platform_fee");

  const doCancel = async (): Promise<void> => {
    const trimmed = note.trim();
    const result = await cancel.mutate({ reason, ...(reason === "other" && trimmed !== "" ? { note: trimmed } : {}) });
    setConfirmOpen(false);
    if (result) {
      rememberCancelOutcome(bookingId, { response: result, driverName });
      navigation.replace("CancelBookingResult", { bookingId });
    }
    else void query.refetch();
  };

  const footer = (
    <View style={styles.footer}>
      <Button testID="CancelBooking.keep" label={copy.keep} onPress={() => navigation.goBack()} />
      {blocked === null ? (
        <Button testID="CancelBooking.confirm" label={copy.confirm} variant="outline" leadingIcon="trash" disabled={cancel.isPending} loading={cancel.isPending} onPress={() => { cancel.reset(); setConfirmOpen(true); }} style={styles.footerGap} />
      ) : (
        <Button testID="CancelBooking.seeBooking" label={copy.blockedSeeBooking} variant="outline" chevron={false} onPress={seeBooking} style={styles.footerGap} />
      )}
    </View>
  );

  return (
    <Screen testID="CancelBooking" paddingX={SIDE} header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <View style={styles.block}>
        <Summary preview={preview} onOpen={seeBooking} />

        {blocked !== null ? (
          <Banner testID="CancelBooking.blocked" kind="warning" title={copy.blockedTitle[blocked.code] ?? copy.blockedFallback} message={blocked.message} style={styles.gap} />
        ) : null}

        <SectionHeader title={copy.reasonTitle} style={styles.section} />
        <View accessibilityRole="radiogroup" accessibilityLabel={copy.reasonA11y}>
          {preview.reasons.map((value) => (
            <RadioRow key={value} testID={`CancelBooking.reason.${value}`} label={PASSENGER_CANCELLATION_REASON_LABELS[value]} selected={reason === value} disabled={blocked !== null} onSelect={() => setReason(value)} style={styles.radio} />
          ))}
        </View>
        {reason === "other" && blocked === null ? (
          <View style={styles.gap}>
            <Text variant="rowTitle" color="heading" size={16.5} style={styles.noteLabel}>{copy.otherNoteLabel}</Text>
            <TextArea testID="CancelBooking.note" value={note} onChangeText={setNote} placeholder={copy.otherNotePlaceholder} maxLength={500} minHeight={64} />
          </View>
        ) : null}

        <View style={[styles.refundHead, styles.section]}>
          <Text variant="titleSm" color="heading" size={18} lineHeight={22} style={styles.flex}>{copy.refundTitle}</Text>
          <InfoButton testID="CancelBooking.refundInfo" label={copy.refundInfoA11y} onPress={() => setInfoOpen(true)} />
        </View>
        <View style={styles.lines} testID="CancelBooking.lines">
          <View style={styles.lineRow} testID="CancelBooking.lineTrip">
            <Icon name="person" size={36} color={colors.primary} />
            <View style={styles.flex}>
              <Text variant="titleSm" color="heading" size={17} lineHeight={21}>{copy.lineTrip}</Text>
              <Text variant="body" color="muted" size={14.5}>{lineTrip ? copy.notes[lineTrip.noteCode] : copy.notes.subject_to_conditions}</Text>
            </View>
            <Text variant="titleSm" color="heading" size={17} testID="CancelBooking.lineTripAmount">{lineTrip ? (lineTrip.amount.cents === null ? copy.pendingValue : formatMoney(lineTrip.amount)) : copy.pendingValue}</Text>
          </View>
          <View style={[styles.lineRow, styles.lineSep]} testID="CancelBooking.lineFee">
            <MvcLogo variant="icon" width={40} />
            <View style={styles.flex}>
              <Text variant="titleSm" color="heading" size={17} lineHeight={21}>{copy.lineFee}</Text>
              <Text variant="body" color="muted" size={14.5}>{lineFee ? copy.notes[lineFee.noteCode] : copy.notes.policy_pending_review}</Text>
            </View>
            <Text variant="titleSm" color="heading" size={17} testID="CancelBooking.lineFeeAmount">{lineFee && lineFee.amount.cents !== null ? formatMoney(lineFee.amount) : copy.pendingValue}</Text>
          </View>
        </View>
        <Banner testID="CancelBooking.legal" kind="info" size="sm" title={preview.legalNotice} style={styles.gap} />

        <View style={styles.footerInline}>{footer}</View>
        {cancel.error ? <Banner testID="CancelBooking.cancelError" kind="error" title={messagesStrings.cancel.loadErrorTitle} message={describeError(cancel.error).message} style={styles.gap} /> : null}
      </View>

      <BottomSheet visible={infoOpen} onClose={() => setInfoOpen(false)} title={copy.infoSheetTitle} testID="CancelBooking.infoSheet">
        <Text variant="body" color="strong" size={16.5} lineHeight={22}>{copy.infoSheetBody}</Text>
        <Text variant="rowTitle" color="heading" size={16.5} style={styles.gap}>{copy.infoSheetPolicy}</Text>
        <Text variant="body" color="strong" size={16} lineHeight={21} testID="CancelBooking.infoPolicy">
          {preview.policy.status === "approved" ? copy.policyApproved(preview.policy.version) : copy.policyPending}
        </Text>
      </BottomSheet>

      <ConfirmDialog
        visible={confirmOpen}
        destructive
        loading={cancel.isPending}
        title={copy.confirmTitle}
        message={copy.confirmMessage(driverName)}
        confirmLabel={copy.confirmYes}
        cancelLabel={copy.confirmNo}
        onConfirm={() => void doCancel()}
        onCancel={() => setConfirmOpen(false)}
        testID="CancelBooking.dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 6, paddingBottom: 20 },
  gap: { marginTop: 12 },
  section: { marginTop: 18 },
  radio: { marginTop: 8 },
  line: { marginTop: 4 },
  noteLabel: { marginBottom: 6 },
  summary: { flexDirection: "row", alignItems: "center", gap: 14, padding: 12, borderRadius: 16, backgroundColor: colors.bg.tint, borderWidth: 1, borderColor: colors.border.soft },
  driver: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  refundHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  lines: { borderRadius: 16, borderWidth: 1, borderColor: colors.border.soft, backgroundColor: colors.bg.white, marginTop: 10, overflow: "hidden" },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  lineSep: { borderTopWidth: 1, borderTopColor: colors.border.soft },
  footer: { paddingBottom: 8 },
  footerInline: { marginTop: 14 },
  footerGap: { marginTop: 10 },
});
