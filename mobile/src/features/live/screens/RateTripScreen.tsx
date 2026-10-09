/**
 * «Valora el viaje» (pantalla suelta, desde «Mis viajes»). Mismo lenguaje que la valoración de la 24. Dos caminos:
 *  - con `bookingId` (pasajero): valora a quien condujo, con los datos de `GET /v1/bookings/{id}/summary`;
 *  - sin `bookingId` (conductor): elige entre los pasajeros que completaron el viaje (`GET /v1/me/trips/{id}/console`).
 * `POST /v1/trips/{tripId}/ratings` con `Idempotency-Key`. Estados: cargando · error · aún no terminó · ya valorado ·
 * plazo cerrado · nadie que valorar · formulario · enviando · error al enviar · gracias.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { LiveRating } from "@/api/types";
import { useDriverConsole } from "@/features/driver/ops/hooks/useDriverConsole";
import type { AppScreenProps } from "@/navigation";
import { Avatar, Banner, Button, RadioRow, RatingStars, Screen, ScreenHeader, SectionHeader, Skeleton, Text, TextArea } from "@/ui";
import { LoadError } from "../components/LoadError";
import { useBookingSummary } from "../hooks/useBookingSummary";
import { useCreateRating } from "../hooks/useCreateRating";
import { liveStrings } from "../strings";

const T = liveStrings.rateTrip;
const F = liveStrings.finished;
const SIDE = 14;

interface FormProps {
  name: string;
  photoUrl?: string | null;
  tripId: string;
  rateeUserId: string;
  onRated: (rating: LiveRating) => void;
}

function RatingForm({ name, photoUrl, tripId, rateeUserId, onRated }: FormProps): React.JSX.Element {
  const rate = useCreateRating(tripId);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [starsError, setStarsError] = useState(false);
  const submit = async (): Promise<void> => {
    if (stars < 1) {
      setStarsError(true);
      return;
    }
    setStarsError(false);
    const done = await rate.mutate({ rateeUserId, stars, ...(comment.trim() !== "" ? { comment: comment.trim() } : {}) });
    if (done) onRated(done);
  };
  return (
    <View testID="RateTrip.form">
      <View style={styles.who}>
        <Avatar source={photoUrl ?? null} name={name} size={56} />
        <Text variant="title" color="heading" size={22}>{name}</Text>
      </View>
      <View style={styles.stars}>
        <RatingStars testID="RateTrip.stars" value={stars} onChange={(v) => { setStars(v); setStarsError(false); }} size={36} />
      </View>
      <Text variant="body" color="muted" size={15} align="center">{F.rateStarsLabel(stars)}</Text>
      <TextArea testID="RateTrip.comment" value={comment} onChangeText={setComment} placeholder={F.rateComment} maxLength={500} minHeight={72} style={styles.gap} />
      {starsError ? <Text testID="RateTrip.starsError" variant="body" color="error" size={15} style={styles.noteTop}>{F.rateNeedStars}</Text> : null}
      {rate.error ? <Banner testID="RateTrip.error" kind="error" title={F.rateFailed} message={describeError(rate.error).message} style={styles.gap} /> : null}
      <Button testID="RateTrip.submit" label={F.rateSubmit} loading={rate.isPending} onPress={() => void submit()} style={styles.gap} />
    </View>
  );
}

function Thanks({ name, stars, onDone }: { name: string; stars: number; onDone: () => void }): React.JSX.Element {
  return (
    <View>
      <Banner testID="RateTrip.thanks" kind="success" title={F.rateThanksTitle} message={`${F.rateThanksMessage(name)} ${F.rateStarsLabel(stars)}.`} />
      <Button testID="RateTrip.done" label={T.done} variant="outline" chevron={false} onPress={onDone} style={styles.gap} />
    </View>
  );
}

function PassengerRating({ tripId, bookingId, onDone }: { tripId: string; bookingId: string; onDone: () => void }): React.JSX.Element {
  const query = useBookingSummary(bookingId);
  const [sent, setSent] = useState<LiveRating | null>(null);
  const summary = query.data;
  if (summary === undefined) {
    return query.error ? (
      <LoadError error={query.error} onRetry={() => void query.refetch()} fallbackLabel={liveStrings.common.back} onFallback={onDone} testID="RateTrip.loadError" />
    ) : (
      <View testID="RateTrip.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
        <Skeleton height={56} radius={14} />
        <Skeleton height={120} radius={14} style={styles.gap} />
      </View>
    );
  }
  const name = summary.driver.firstName;
  const mine = sent ?? summary.rating.mine;
  if (mine !== null) return sent !== null ? <Thanks name={name} stars={mine.stars} onDone={onDone} /> : <Banner testID="RateTrip.alreadyRated" kind="success" title={F.rateBlocked.already_rated} message={F.rateStarsLabel(mine.stars)} />;
  if (!summary.rating.canRate) {
    const reason = summary.rating.reason;
    return <Banner testID="RateTrip.blocked" kind="notice" size="sm" title={reason !== null ? F.rateBlocked[reason] : T.notFinished} />;
  }
  return <RatingForm name={name} photoUrl={summary.driver.photoUrl} tripId={tripId} rateeUserId={summary.rating.rateeUserId} onRated={setSent} />;
}

function DriverRating({ tripId, onDone }: { tripId: string; onDone: () => void }): React.JSX.Element {
  const consoleQuery = useDriverConsole(tripId);
  const [picked, setPicked] = useState<string | null>(null);
  const [sent, setSent] = useState<{ name: string; stars: number } | null>(null);
  const data = consoleQuery.data;
  if (data === undefined) {
    return consoleQuery.error ? (
      <LoadError error={consoleQuery.error} onRetry={() => void consoleQuery.refetch()} fallbackLabel={liveStrings.common.back} onFallback={onDone} testID="RateTrip.loadError" />
    ) : (
      <View testID="RateTrip.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
        <Skeleton height={56} radius={14} />
        <Skeleton height={120} radius={14} style={styles.gap} />
      </View>
    );
  }
  if (data.status !== "completed") return <Banner testID="RateTrip.blocked" kind="notice" size="sm" title={T.notFinished} />;
  if (sent !== null) {
    return (
      <View>
        <Thanks name={sent.name} stars={sent.stars} onDone={() => { setSent(null); setPicked(null); }} />
      </View>
    );
  }
  const candidates = data.passengers.filter((p) => p.bookingStatus === "completed");
  const pending = candidates.filter((p) => !p.ratedByMe);
  if (candidates.length === 0 || pending.length === 0) return <Banner testID="RateTrip.none" kind="success" size="sm" title={T.noneToRate} />;
  const chosen = pending.find((p) => p.passenger.id === picked) ?? null;
  return (
    <View>
      <SectionHeader title={T.chooseTitle} />
      {pending.map((p) => (
        <RadioRow
          key={p.bookingId}
          testID={`RateTrip.passenger.${p.bookingId}`}
          label={p.passenger.firstName}
          selected={picked === p.passenger.id}
          onSelect={() => setPicked(p.passenger.id)}
          style={styles.radio}
        />
      ))}
      {chosen !== null ? (
        <View style={styles.gapLg}>
          <RatingForm
            key={chosen.passenger.id}
            name={chosen.passenger.firstName}
            photoUrl={chosen.passenger.photoUrl}
            tripId={tripId}
            rateeUserId={chosen.passenger.id}
            onRated={(rating) => { setSent({ name: chosen.passenger.firstName, stars: rating.stars }); void consoleQuery.refetch(); }}
          />
        </View>
      ) : null}
    </View>
  );
}

export function RateTripScreen({ navigation, route }: AppScreenProps<"RateTrip">): React.JSX.Element {
  const { tripId, bookingId } = route.params;
  const done = (): void => navigation.goBack();
  return (
    <Screen testID="RateTrip" paddingX={SIDE} header={<ScreenHeader title={T.title} testID="RateTrip.header" />}>
      <View style={styles.block}>{bookingId !== undefined ? <PassengerRating tripId={tripId} bookingId={bookingId} onDone={done} /> : <DriverRating tripId={tripId} onDone={done} />}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 14 },
  gapLg: { marginTop: 20 },
  noteTop: { marginTop: 6 },
  radio: { marginTop: 8 },
  who: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 10 },
  stars: { alignItems: "center", marginVertical: 8 },
});
