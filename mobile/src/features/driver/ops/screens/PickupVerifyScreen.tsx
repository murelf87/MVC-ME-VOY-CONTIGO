/**
 * Verificar el código de recogida (conductor). Sin lámina propia: se diseña con la «Código de recogida» de la 23 (tarjeta
 * azul clara con seis casillas) y el «Código incorrecto: inténtalo de nuevo.» de la 04 (franja roja bajo las casillas).
 *
 * El conductor teclea el código de 6 cifras que le enseña el pasajero; el servidor lo comprueba (hash + intentos) y es
 * quien dice si queda verificado, si falló y cuántos intentos quedan, o si el código se bloqueó. La pantalla solo traduce:
 *  - teclado numérico propio (teclas grandes, sin el teclado del sistema tapando la pantalla);
 *  - sin envío automático: «Verificar código» es explícito y, tras un fallo, hay que cambiar el código para reintentar
 *    (no se gastan intentos del pasajero por pulsar dos veces);
 *  - éxito: confirmación + «Siguiente recogida» o «Volver a la consola»; ya verificada (idempotente): se cuenta tal cual;
 *  - bloqueado / sin generar / viaje parado / reserva ya cerrada: tarjeta con el motivo y la acción posible.
 *
 * Estados: cargando · error con reintento · sin conexión · elegir pasajero (sin `bookingId`) · formulario ·
 * código incorrecto con intentos · verificando · éxito · ya verificada · bloqueado · sin código · viaje no en marcha ·
 * reserva cancelada / no presentada / no encontrada.
 */
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { LiveConsole } from "@/api/types";
import { formatTime } from "@/i18n";
import { useIsOnline } from "@/hooks";
import type { AppScreenProps } from "@/navigation";
import { Banner, Button, Card, EmptyState, OfflineBanner, Screen, ScreenHeader, Skeleton, Text } from "@/ui";
import { CodeBoxes } from "../components/CodeBoxes";
import { NumericKeypad } from "../components/NumericKeypad";
import { OpsErrorCard } from "../components/OpsErrorCard";
import { PickupChooser } from "../components/PickupChooser";
import { PickupNotice } from "../components/PickupNotice";
import { PickupPassengerHeader } from "../components/PickupPassengerHeader";
import { PickupResult } from "../components/PickupResult";
import { describeOps } from "../hooks/describe";
import { useBackToConsole } from "../hooks/useBackToConsole";
import { useDriverConsole } from "../hooks/useDriverConsole";
import { usePickupVerify } from "../hooks/usePickupVerify";
import { passengerRows, serverNowMs, stopLabel } from "../logic/console";
import type { OpsErrorAction } from "../logic/errors";
import { canSubmitCode, missingDigits, nextPendingAfter, pendingPickups, pickupContext, sanitizeCode, type PickupMode } from "../logic/pickup";
import { opsStrings } from "../strings";

const COPY = opsStrings.pickup;
const FORM = COPY.form;
const SCREEN_X = 14;

function PickupSkeleton(): React.JSX.Element {
  return (
    <View testID="PickupVerify.loading" accessible accessibilityLabel={COPY.states.loading} accessibilityState={{ busy: true }} style={styles.block}>
      <Skeleton height={60} radius={14} />
      <Skeleton height={190} radius={14} style={styles.gap} />
      <Skeleton height={250} radius={14} style={styles.gap} />
    </View>
  );
}

export function PickupVerifyScreen({ navigation, route }: AppScreenProps<"PickupVerify">): React.JSX.Element {
  const { tripId, bookingId: requested } = route.params;
  const query = useDriverConsole(tripId);
  const data = query.data;
  const receivedAtMs = query.receivedAtMs ?? 0;
  const online = useIsOnline();
  const backToConsole = useBackToConsole(tripId);
  const pending = useMemo(() => (data ? pendingPickups(data) : []), [data]);
  // Con un solo pasajero pendiente no hay nada que elegir.
  const bookingId = requested ?? (pending.length === 1 ? pending[0]?.bookingId : undefined);
  const header = <ScreenHeader title={COPY.title} testID="PickupVerify.header" />;

  const onRefresh = useCallback(() => void query.refetch(), [query]);
  const choose = useCallback((id: string) => navigation.setParams({ bookingId: id }), [navigation]);
  const goNext = useCallback((id: string) => navigation.replace("PickupVerify", { tripId, bookingId: id }), [navigation, tripId]);

  // ── Sin datos todavía ──────────────────────────────────────────────────────────────────────────────────────────────
  if (data === undefined) {
    if (query.isError || query.isOffline) {
      const error = describeOps(query.error);
      return (
        <Screen testID="PickupVerify" paddingX={SCREEN_X} header={header}>
          <View style={styles.block}>
            <OpsErrorCard
              testID="PickupVerify.error"
              error={error}
              onAction={(action: Exclude<OpsErrorAction, "none">) => {
                if (action === "openConsole") backToConsole();
                else void query.refetch();
              }}
            />
            <Button testID="PickupVerify.back" label={COPY.chooser.backToConsole} variant="outline" chevron={false} onPress={backToConsole} style={styles.gap} />
          </View>
        </Screen>
      );
    }
    return (
      <Screen testID="PickupVerify" paddingX={SCREEN_X} header={header}>
        <PickupSkeleton />
      </Screen>
    );
  }

  // ── Sin reserva elegida ────────────────────────────────────────────────────────────────────────────────────────────
  if (bookingId === undefined) {
    return (
      <Screen testID="PickupVerify" paddingX={SCREEN_X} header={header} refreshing={query.isRefreshing} onRefresh={onRefresh}>
        <View style={styles.block}>
          {pending.length === 0 ? (
            <EmptyState
              testID="PickupVerify.empty"
              icon="passenger"
              title={COPY.chooser.empty}
              message={COPY.chooser.emptyDetail}
              actionLabel={COPY.chooser.backToConsole}
              onAction={backToConsole}
            />
          ) : (
            <PickupChooser testID="PickupVerify.chooser" passengers={pending} onChoose={choose} />
          )}
        </View>
      </Screen>
    );
  }

  return (
    <PickupContent
      key={bookingId}
      tripId={tripId}
      bookingId={bookingId}
      data={data}
      receivedAtMs={receivedAtMs}
      online={online}
      refreshing={query.isRefreshing}
      onRefresh={onRefresh}
      onBack={backToConsole}
      onNext={goNext}
      header={header}
    />
  );
}

interface PickupContentProps {
  tripId: string;
  bookingId: string;
  data: LiveConsole;
  receivedAtMs: number;
  online: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onNext: (bookingId: string) => void;
  header: React.ReactNode;
}

function noticeFor(mode: PickupMode): { title: string; message: string } | null {
  const B = COPY.blocked;
  switch (mode.kind) {
    case "not_eligible":
      if (mode.reason === "cancelled") return { title: B.cancelledTitle, message: B.cancelledMessage };
      if (mode.reason === "no_show") return { title: B.noShowTitle, message: B.noShowMessage };
      return { title: B.notEligibleTitle, message: B.notEligibleMessage };
    case "trip_not_live":
      return { title: B.notLiveTitle, message: B.notLiveMessage };
    case "missing_booking":
      return { title: COPY.states.bookingNotFoundTitle, message: COPY.states.bookingNotFoundMessage };
    default:
      return null;
  }
}

function PickupContent({ tripId, bookingId, data, receivedAtMs, online, refreshing, onRefresh, onBack, onNext, header }: PickupContentProps): React.JSX.Element {
  const context = useMemo(() => pickupContext(data, bookingId), [data, bookingId]);
  const row = useMemo(
    () => passengerRows(data, serverNowMs(data.serverTime, receivedAtMs, Date.now())).find((r) => r.bookingId === bookingId) ?? null,
    [data, bookingId, receivedAtMs],
  );
  const verify = usePickupVerify(tripId, bookingId);
  const [code, setCode] = useState("");
  const { reset: resetVerify } = verify;

  const name = context.passenger?.passenger.firstName ?? "";
  const failure = verify.error;
  const wrongCode = failure?.code === "PICKUP_CODE_INVALID";
  const lockedNow = context.mode.kind === "locked" || failure?.code === "PICKUP_ATTEMPTS_EXCEEDED";
  const notGeneratedNow = context.mode.kind === "not_generated" || failure?.code === "PICKUP_CODE_NOT_GENERATED";

  const edit = useCallback(
    (next: string) => {
      resetVerify();
      setCode(next);
    },
    [resetVerify],
  );
  const onDigit = useCallback((digit: string) => edit(sanitizeCode(code + digit)), [code, edit]);
  const onBackspace = useCallback(() => edit(code.slice(0, -1)), [code, edit]);
  const onClear = useCallback(() => edit(""), [edit]);

  const canSubmit = canSubmitCode(code, { pending: verify.isPending, offline: !online }) && !wrongCode;
  const submit = useCallback(async () => {
    if (!canSubmit) return;
    await verify.verify(code);
  }, [canSubmit, code, verify]);

  const recheck = useCallback(() => {
    resetVerify();
    onRefresh();
  }, [onRefresh, resetVerify]);

  const next = useMemo(() => {
    const candidate = nextPendingAfter(data, bookingId);
    return candidate ? { bookingId: candidate.bookingId, name: candidate.passenger.firstName, place: stopLabel(candidate.pickup) } : null;
  }, [data, bookingId]);

  const shell = (children: React.ReactNode, footer?: React.ReactNode): React.JSX.Element => (
    <Screen testID="PickupVerify" paddingX={SCREEN_X} header={header} {...(footer ? { footer } : {})} refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.block}>{children}</View>
    </Screen>
  );

  const backButton = (
    <Button testID="PickupVerify.back" label={COPY.chooser.backToConsole} variant="outline" chevron={false} onPress={onBack} style={styles.gap} />
  );

  // ── Verificada ─────────────────────────────────────────────────────────────────────────────────────────────────────
  if (verify.result || context.mode.kind === "already_verified") {
    const already = verify.result ? verify.result.alreadyVerified : true;
    const at = verify.result ? verify.result.pickedUpAt : context.mode.kind === "already_verified" ? context.mode.at : null;
    return shell(
      <PickupResult testID="PickupVerify.result" name={name} alreadyVerified={already} time={at ? formatTime(at) : null} next={next} />,
      <View>
        {next ? (
          <>
            <Button testID="PickupVerify.next" label={COPY.result.nextPickup} onPress={() => onNext(next.bookingId)} />
            <Button testID="PickupVerify.back" label={COPY.result.backToConsole} variant="outline" chevron={false} onPress={onBack} style={styles.gap} />
          </>
        ) : (
          <Button testID="PickupVerify.back" label={COPY.result.backToConsole} onPress={onBack} />
        )}
      </View>,
    );
  }

  // ── No se puede verificar ahora ────────────────────────────────────────────────────────────────────────────────────
  const notice = noticeFor(context.mode);
  if (notice) {
    const live = context.mode.kind === "trip_not_live";
    return shell(
      <>
        {row ? <PickupPassengerHeader row={row} testID="PickupVerify.passenger" /> : null}
        <View style={styles.gap}>
          <PickupNotice
            testID="PickupVerify.notice"
            kind={live ? "not_live" : context.mode.kind === "missing_booking" ? "missing" : "not_eligible"}
            title={notice.title}
            message={notice.message}
            {...(live ? { actionLabel: COPY.blocked.notLiveAction, onAction: onBack } : {})}
          />
        </View>
        {live ? null : backButton}
      </>,
    );
  }
  if (lockedNow) {
    return shell(
      <>
        {row ? <PickupPassengerHeader row={row} testID="PickupVerify.passenger" /> : null}
        <View style={styles.gap}>
          <PickupNotice
            testID="PickupVerify.locked"
            kind="locked"
            title={COPY.blocked.lockedTitle}
            message={COPY.blocked.lockedMessage(name)}
            actionLabel={COPY.blocked.lockedAction}
            onAction={recheck}
          />
        </View>
        {backButton}
      </>,
    );
  }
  if (notGeneratedNow) {
    return shell(
      <>
        {row ? <PickupPassengerHeader row={row} testID="PickupVerify.passenger" /> : null}
        <View style={styles.gap}>
          <PickupNotice
            testID="PickupVerify.notGenerated"
            kind="not_generated"
            title={COPY.blocked.notGeneratedTitle}
            message={COPY.blocked.notGeneratedMessage(name)}
            note={COPY.blocked.notGeneratedWaiting}
            actionLabel={COPY.blocked.notGeneratedAction}
            onAction={recheck}
          />
        </View>
        {backButton}
      </>,
    );
  }

  // ── Formulario ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const attemptsLeft = context.passenger?.code.attemptsRemaining ?? failure?.attempts?.remaining ?? null;
  const missing = missingDigits(code);
  const hint = verify.isPending ? FORM.verifying : missing > 0 ? FORM.missingDigits(missing) : FORM.complete;
  const otherFailure = failure && !wrongCode ? failure : null;

  return shell(
    <>
      {!online ? <OfflineBanner testID="PickupVerify.offline" title={opsStrings.common.offlineTitle} detail={FORM.offlineHint} style={styles.offline} /> : null}
      {row ? <PickupPassengerHeader row={row} testID="PickupVerify.passenger" /> : null}

      <Card tone="blue" padding={16} style={styles.codeCard} testID="PickupVerify.codeCard">
        <Text variant="heading" color="heading" size={21} lineHeight={26} align="center" accessibilityRole="header">
          {FORM.heading(name)}
        </Text>
        <Text variant="rowText" color="muted" size={15.5} lineHeight={20} align="center" style={styles.subheading}>
          {FORM.subheading}
        </Text>
        <CodeBoxes testID="PickupVerify.code" value={code} active={!verify.isPending} accessibilityLabel={FORM.codeAccessibility(code)} />
        <Text testID="PickupVerify.hint" variant="rowTitle" color="strong" size={16} lineHeight={20} align="center" accessibilityLiveRegion="polite" style={styles.hint}>
          {hint}
        </Text>
        {attemptsLeft !== null ? (
          <Text testID="PickupVerify.attempts" variant="rowText" color={attemptsLeft <= 2 ? "warning" : "muted"} size={15} lineHeight={19} align="center" style={styles.attempts}>
            {FORM.attemptsLeft(attemptsLeft)}
          </Text>
        ) : null}
      </Card>

      {wrongCode ? (
        <Banner testID="PickupVerify.wrongCode" kind="error" size="sm" message={FORM.wrongCode} style={styles.gap} />
      ) : null}
      {otherFailure ? (
        <View style={styles.gap}>
          <OpsErrorCard
            testID="PickupVerify.error"
            error={otherFailure}
            onAction={(action: Exclude<OpsErrorAction, "none">) => {
              if (action === "openConsole") onBack();
              else if (action === "retry") void submit();
              else recheck();
            }}
          />
        </View>
      ) : null}

      <View style={styles.keypad}>
        <NumericKeypad testID="PickupVerify.keypad" disabled={verify.isPending} onDigit={onDigit} onBackspace={onBackspace} onClear={onClear} />
      </View>

      <Banner testID="PickupVerify.info" kind="info" size="xs" title={FORM.infoTitle} message={FORM.infoMessage} style={styles.info} />
    </>,
    <Button testID="PickupVerify.submit" label={FORM.submit} loading={verify.isPending} disabled={!canSubmit} onPress={() => void submit()} />,
  );
}

const styles = StyleSheet.create({
  block: { paddingTop: 6 },
  gap: { marginTop: 12 },
  offline: { marginBottom: 12 },
  codeCard: { marginTop: 14, alignItems: "stretch" },
  subheading: { marginTop: 4, marginBottom: 14 },
  hint: { marginTop: 12 },
  attempts: { marginTop: 2 },
  keypad: { marginTop: 14 },
  info: { marginTop: 4 },
});
