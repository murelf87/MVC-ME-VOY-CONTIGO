/**
 * «Reportar incidencia» (pasajero o conductor, desde «Viaje terminado» o «Mis viajes»). Sin lámina propia: se diseña con
 * el lenguaje de la 28 (filas de opción única, aviso, campo de texto) y de la 24 (botones). Categoría + descripción
 * (10–2000 caracteres) + hasta 5 fotos a almacenamiento privado. Si hay peligro inmediato se ofrece llamar al 112.
 *
 * La incidencia se crea primero (`POST /v1/incident-reports`, `Idempotency-Key`); después se suben las fotos una a una. Si
 * alguna foto falla la incidencia YA está enviada y se ofrece reintentar solo esas fotos. Estados: cargando viajes · sin
 * viajes · validación por campo · permiso de cámara denegado/bloqueado · formato/tamaño · enviando · subiendo fotos ·
 * error al enviar · enviada · enviada con fotos pendientes · almacenamiento privado no disponible.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { LiveIncidentCategory, LiveIncidentReport, OverviewCard, TripOverviewCard } from "@/api/types";
import { Icon } from "@/icons";
import { useTripsHistory } from "@/features/profile/hooks/useTripsOverview";
import type { AppScreenProps } from "@/navigation";
import { callPhone, openAppSettings } from "@/platform";
import { colors } from "@/theme";
import { Banner, Button, Card, OptionSheet, RadioRow, Screen, ScreenHeader, SectionHeader, Skeleton, Text, TextArea } from "@/ui";
import { useCreateIncident } from "../hooks/useIncidents";
import { MAX_INCIDENT_PHOTOS, pickIncidentPhoto, uploadIncidentPhoto, useIncidentPhotos, type LocalPhoto, type PhotoSource } from "../hooks/useIncidentPhotos";
import { liveStrings } from "../strings";

const T = liveStrings.report;
const SIDE = 14;
const CATEGORIES: readonly LiveIncidentCategory[] = ["safety", "driver_behavior", "passenger_behavior", "vehicle", "route_or_schedule", "payment", "lost_item", "other"];

interface TripChoice {
  key: string;
  tripId: string;
  bookingId: string | null;
  title: string;
  line: string;
}

const isTrip = (card: OverviewCard): card is TripOverviewCard => card.kind === "trip";

function choiceOf(card: TripOverviewCard): TripChoice {
  return {
    key: `${card.role}:${card.tripId}:${card.bookingId ?? ""}`,
    tripId: card.tripId,
    bookingId: card.bookingId,
    title: card.title,
    line: `${card.from.label ?? ""} → ${card.to.label ?? ""} · ${card.from.timeLocal} · ${card.status.label}`,
  };
}

interface Errors {
  trip?: string;
  category?: string;
  description?: string;
}

export function ReportIncidentScreen({ navigation, route }: AppScreenProps<"ReportIncident">): React.JSX.Element {
  const fixedTripId = route.params?.tripId;
  const fixedBookingId = route.params?.bookingId;
  const chooseTrip = fixedTripId === undefined;

  const passengerHistory = useTripsHistory("passenger", chooseTrip);
  const driverHistory = useTripsHistory("driver", chooseTrip);
  const choices = useMemo<TripChoice[]>(
    () => [...passengerHistory.items, ...driverHistory.items].filter(isTrip).filter((card) => card.phase !== "scheduled").slice(0, 12).map(choiceOf),
    [passengerHistory.items, driverHistory.items],
  );
  const loadingTrips = chooseTrip && (passengerHistory.isLoading || driverHistory.isLoading) && choices.length === 0;

  const [tripKey, setTripKey] = useState<string | null>(null);
  const [category, setCategory] = useState<LiveIncidentCategory | null>(null);
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [sheet, setSheet] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<{ message: string; settings: boolean } | null>(null);
  const photoList = useIncidentPhotos();
  const create = useCreateIncident();

  const [phase, setPhase] = useState<{ step: "form" } | { step: "uploading"; done: number; total: number } | { step: "sent"; report: LiveIncidentReport; failed: LocalPhoto[]; retrying: boolean }>({ step: "form" });

  const chosen = choices.find((c) => c.key === tripKey);
  const header = <ScreenHeader title={T.title} testID="ReportIncident.header" />;

  const addPhoto = useCallback(
    async (source: PhotoSource) => {
      setSheet(false);
      setPhotoNotice(null);
      const result = await pickIncidentPhoto(source);
      switch (result.status) {
        case "picked":
          photoList.add(result.photo);
          return;
        case "denied":
          setPhotoNotice({ message: T.photoDenied, settings: false });
          return;
        case "blocked":
          setPhotoNotice({ message: T.photoBlocked, settings: true });
          return;
        case "unavailable":
          setPhotoNotice({ message: T.photoUnavailable, settings: false });
          return;
        case "invalid":
          setPhotoNotice({ message: result.reason === "type" ? T.photoType : T.photoSize, settings: false });
          return;
        case "cancelled":
          return;
      }
    },
    [photoList],
  );

  const uploadAll = async (report: LiveIncidentReport, list: LocalPhoto[]): Promise<LocalPhoto[]> => {
    const failed: LocalPhoto[] = [];
    for (let i = 0; i < list.length; i += 1) {
      setPhase({ step: "uploading", done: i, total: list.length });
      const photo = list[i] as LocalPhoto;
      const outcome = await uploadIncidentPhoto(report.id, photo);
      if (!outcome.ok) failed.push(photo);
    }
    return failed;
  };

  const submit = async (): Promise<void> => {
    const found: Errors = {};
    const tripId = chooseTrip ? chosen?.tripId : fixedTripId;
    if (tripId === undefined) found.trip = T.tripRequired;
    if (category === null) found.category = T.categoryRequired;
    const text = description.trim();
    if (text.length < 10) found.description = T.descriptionTooShort;
    if (text.length > 2000) found.description = T.descriptionTooLong;
    setErrors(found);
    if (Object.keys(found).length > 0 || tripId === undefined || category === null) return;
    const bookingId = chooseTrip ? (chosen?.bookingId ?? undefined) : fixedBookingId;
    const report = await create.mutate({ tripId, category, description: text, ...(bookingId ? { bookingId } : {}) });
    if (!report) return;
    const list = photoList.photos;
    const failed = list.length > 0 ? await uploadAll(report, list) : [];
    photoList.clear();
    setPhase({ step: "sent", report, failed, retrying: false });
  };

  const retryPhotos = async (): Promise<void> => {
    if (phase.step !== "sent") return;
    setPhase({ ...phase, retrying: true });
    const failed = await uploadAll(phase.report, phase.failed);
    setPhase({ step: "sent", report: phase.report, failed, retrying: false });
  };

  if (phase.step === "sent") {
    const failedCount = phase.failed.length;
    return (
      <Screen
        testID="ReportIncident"
        paddingX={SIDE}
        header={header}
        footer={
          <View style={styles.footer}>
            <Button testID="ReportIncident.viewMine" label={T.viewMine} onPress={() => navigation.replace("IncidentReports")} />
            <Button testID="ReportIncident.back" label={T.backToTrip} variant="outline" chevron={false} onPress={() => navigation.goBack()} style={styles.gap} />
          </View>
        }
      >
        <View style={styles.block}>
          <Banner
            testID="ReportIncident.sent"
            kind={failedCount > 0 ? "warning" : "success"}
            title={failedCount > 0 ? T.sentPhotosFailedTitle : T.sentTitle}
            message={failedCount > 0 ? T.sentPhotosFailedMessage(failedCount) : T.sentMessage}
          />
          {failedCount > 0 ? <Button testID="ReportIncident.retryPhotos" label={T.retryPhotos} variant="outline" loading={phase.retrying} onPress={() => void retryPhotos()} style={styles.gap} /> : null}
        </View>
      </Screen>
    );
  }

  const busy = create.isPending || phase.step === "uploading";
  const footer = (
    <View style={styles.footer}>
      <Button
        testID="ReportIncident.submit"
        label={phase.step === "uploading" ? T.uploading(phase.done, phase.total) : create.isPending ? T.sending : T.submit}
        loading={busy}
        onPress={() => void submit()}
      />
    </View>
  );

  return (
    <Screen testID="ReportIncident" paddingX={SIDE} header={header} footer={footer}>
      <View style={styles.block}>
        <Text variant="body" color="strong" size={17} lineHeight={23}>{T.intro}</Text>

        <Card tone="red" padding={12} style={styles.gap} testID="ReportIncident.emergency">
          <View style={styles.emergency}>
            <Icon name="exclaim" size={26} color={colors.error.solid} />
            <View style={styles.flex}>
              <Text variant="rowTitle" color="error" size={16.5}>{T.emergencyTitle}</Text>
              <Text variant="body" color="strong" size={14.5} lineHeight={19}>{T.emergencyMessage}</Text>
            </View>
          </View>
          <Button testID="ReportIncident.call112" label={T.call112} variant="dangerOutline" leadingIcon="phone" chevron={false} size="sm" onPress={() => void callPhone("112")} style={styles.gapSm} />
        </Card>

        {chooseTrip ? (
          <>
            <SectionHeader title={T.tripTitle} style={styles.section} />
            {loadingTrips ? (
              <View testID="ReportIncident.tripsLoading">
                <Skeleton height={64} radius={14} />
              </View>
            ) : passengerHistory.error && driverHistory.error && choices.length === 0 ? (
              <Banner testID="ReportIncident.tripsError" kind="error" title={T.tripLoadFailed} message={describeError(passengerHistory.error).message} />
            ) : choices.length === 0 ? (
              <Banner testID="ReportIncident.tripsEmpty" kind="notice" size="sm" title={T.tripNone} />
            ) : (
              choices.map((choice) => (
                <RadioRow
                  key={choice.key}
                  testID={`ReportIncident.trip.${choice.tripId}`}
                  label={`${choice.title} · ${choice.line}`}
                  selected={tripKey === choice.key}
                  onSelect={() => {
                    setTripKey(choice.key);
                    setErrors((e) => ({ ...e, trip: undefined }));
                  }}
                  style={styles.radio}
                />
              ))
            )}
            {errors.trip ? <Text testID="ReportIncident.tripError" variant="body" color="error" size={15} style={styles.noteTop}>{errors.trip}</Text> : null}
          </>
        ) : null}

        <SectionHeader title={T.categoryTitle} style={styles.section} />
        {CATEGORIES.map((value) => (
          <RadioRow
            key={value}
            testID={`ReportIncident.category.${value}`}
            label={T.categories[value]}
            selected={category === value}
            onSelect={() => {
              setCategory(value);
              setErrors((e) => ({ ...e, category: undefined }));
            }}
            style={styles.radio}
          />
        ))}
        {errors.category ? <Text testID="ReportIncident.categoryError" variant="body" color="error" size={15} style={styles.noteTop}>{errors.category}</Text> : null}

        <SectionHeader title={T.descriptionTitle} style={styles.section} />
        <TextArea
          testID="ReportIncident.description"
          value={description}
          onChangeText={(value) => {
            setDescription(value);
            setErrors((e) => ({ ...e, description: undefined }));
          }}
          placeholder={T.descriptionPlaceholder}
          maxLength={2000}
          minHeight={120}
          {...(errors.description ? { error: errors.description } : {})}
        />

        <View style={styles.photosHead}>
          <Text variant="rowTitle" color="heading" size={18}>{T.photosTitle}</Text>
          <Text variant="body" color="muted" size={15}> {T.photosOptional}</Text>
        </View>
        <View style={styles.photos}>
          {photoList.photos.map((photo, index) => (
            <View key={photo.key} style={styles.photo} testID={`ReportIncident.photo.${index + 1}`}>
              <Image source={{ uri: photo.uri }} style={styles.photoImage} accessibilityLabel={`Foto ${index + 1}`} />
              <Pressable accessibilityRole="button" accessibilityLabel={T.photosRemove(index + 1)} onPress={() => photoList.remove(photo.key)} style={styles.photoRemove} testID={`ReportIncident.photoRemove.${index + 1}`} hitSlop={8}>
                <Icon name="close" size={14} color={colors.onPrimary} />
              </Pressable>
            </View>
          ))}
          {photoList.photos.length < MAX_INCIDENT_PHOTOS ? (
            <Pressable testID="ReportIncident.addPhoto" accessibilityRole="button" accessibilityLabel={T.photosAdd} onPress={() => setSheet(true)} style={({ pressed }) => [styles.add, pressed ? { opacity: 0.85 } : null]}>
              <Icon name="camera" size={26} color={colors.primary} />
              <Text variant="caption" color="primary" size={13} align="center">{T.photosAdd}</Text>
            </Pressable>
          ) : null}
        </View>
        {photoList.photos.length >= MAX_INCIDENT_PHOTOS ? <Text variant="caption" color="muted" size={14}>{T.photosLimit}</Text> : null}
        {photoNotice ? (
          <Banner
            testID="ReportIncident.photoNotice"
            kind="warning"
            size="sm"
            title={photoNotice.message}
            style={styles.gapSm}
            {...(photoNotice.settings ? { actionLabel: "Abrir ajustes", onAction: () => void openAppSettings() } : {})}
          />
        ) : null}
        <Text variant="caption" color="muted" size={13.5} style={styles.noteTop}>{T.privateNote}</Text>

        {create.error ? <Banner testID="ReportIncident.error" kind="error" title={T.sendFailed} message={describeError(create.error).message} style={styles.gap} /> : null}
      </View>

      <OptionSheet<PhotoSource>
        visible={sheet}
        title={T.photoSheetTitle}
        options={[
          { value: "camera", label: T.photoTake, icon: "camera" },
          { value: "library", label: T.photoLibrary, icon: "image" },
        ]}
        onSelect={(source) => void addPhoto(source)}
        onClose={() => setSheet(false)}
        testID="ReportIncident.photoSheet"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 24 },
  gap: { marginTop: 12 },
  gapSm: { marginTop: 8 },
  section: { marginTop: 18 },
  radio: { marginTop: 8 },
  noteTop: { marginTop: 6 },
  footer: { paddingHorizontal: SIDE, paddingBottom: 8 },
  emergency: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  photosHead: { flexDirection: "row", alignItems: "baseline", marginTop: 18, marginBottom: 8 },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photo: { width: 84, height: 84, borderRadius: 12, overflow: "hidden", backgroundColor: colors.bg.tint },
  photoImage: { width: "100%", height: "100%" },
  photoRemove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.heading },
  add: { width: 84, height: 84, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary, backgroundColor: colors.bg.tint },
});
