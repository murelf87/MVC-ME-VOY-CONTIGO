import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { useAppNavigation, useAppRoute } from "@/navigation";
import { colors, radii } from "@/theme";
import { Banner, Button, ConfirmDialog, EmptyState, ListRow, OfflineBanner, Screen, Skeleton, Text, showToast } from "@/ui";
import { ChoiceSheet } from "../components/ChoiceSheet";
import { DriverHeader } from "../components/DriverHeader";
import { FieldRow } from "../components/FieldRow";
import { LoadFailure } from "../components/LoadFailure";
import { NoticeBanner } from "../components/NoticeBanner";
import { PillStepper } from "../components/PillStepper";
import { RequirementRow } from "../components/RequirementRow";
import { UploadSourceSheet } from "../components/UploadSourceSheet";
import { VehiclePhotoCard } from "../components/VehiclePhotoCard";
import { DRIVER_SIDE, DRIVER_TOP_GAP } from "../components/metrics";
import { useDriverReadiness, useRequirementRows } from "../hooks/useDriverReadiness";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { useUploadFlow } from "../hooks/useUploadFlow";
import { useVehicleEditor, type SubmitOutcome } from "../hooks/useVehicleEditor";
import { useSelectedVehicle, useVehicles } from "../hooks/useVehicles";
import { describePublishError } from "../logic/errors";
import { hasPendingRows, visibleRows, type RequirementTarget } from "../logic/readiness";
import { MAKE_NAMES, MAX_SEATS, MIN_SEATS, modelsFor, vehicleName } from "../logic/vehicle";
import { publishStrings } from "../strings";

const copy = publishStrings.vehicle;

/**
 * 17 · «Tu vehículo»: foto, marca, modelo, matrícula, plazas disponibles y los requisitos para publicar (permiso de
 * conducir y seguro, más lo que falte), con «Guardar» fijo al pie. Cambiar los datos de un vehículo aprobado reinicia su
 * revisión: se avisa antes. Sin vehículo, invita a añadirlo.
 */
export function MyVehicleScreen(): React.JSX.Element {
  const navigation = useAppNavigation();
  const { params } = useAppRoute("MyVehicle");
  const vehicles = useVehicles();
  const readiness = useDriverReadiness();
  const { vehicle, others } = useSelectedVehicle(vehicles.data, params?.vehicleId);
  const rows = useRequirementRows(readiness.data);
  const shownRows = React.useMemo(() => visibleRows(rows), [rows]);
  const editor = useVehicleEditor(vehicle, { withColor: false });
  const upload = useUploadFlow();
  const guard = useUnsavedGuard(editor.dirty);
  const [sheet, setSheet] = React.useState<"make" | "model" | null>(null);
  const [confirmSave, setConfirmSave] = React.useState(false);

  const header = <DriverHeader title={copy.title} testID="MyVehicle.header" />;
  const frame = { paddingTop: DRIVER_TOP_GAP } as const;

  const openTarget = (target: RequirementTarget): void => {
    switch (target.route) {
      case "ProfilePhoto":
        navigation.navigate("ProfilePhoto");
        return;
      case "PrivateCheckCapture":
        navigation.navigate("PrivateCheckCapture");
        return;
      case "PrivateCheckStatus":
        navigation.navigate("PrivateCheckStatus");
        return;
      case "VehicleForm":
        navigation.navigate("VehicleForm", target.vehicleId === undefined ? undefined : { vehicleId: target.vehicleId });
        return;
      case "VehicleDocuments":
        navigation.navigate("VehicleDocuments", { vehicleId: target.vehicleId });
        return;
    }
  };

  const afterSubmit = (outcome: SubmitOutcome): void => {
    switch (outcome.status) {
      case "invalid":
        showToast({ message: outcome.message, kind: "warning" });
        return;
      case "clean":
        showToast({ message: copy.noChanges, kind: "info" });
        return;
      case "needs_confirm":
        setConfirmSave(true);
        return;
      case "saved":
        guard.release();
        showToast({ message: copy.saved, kind: "success" });
        return;
      case "failed":
        return;
    }
  };

  const onSave = async (): Promise<void> => {
    afterSubmit(await editor.submit());
  };

  const onConfirmSave = async (): Promise<void> => {
    const outcome = await editor.submit({ confirmed: true });
    setConfirmSave(false);
    if (outcome.status === "saved") showToast({ message: copy.savedReview, kind: "success" });
    else afterSubmit(outcome);
  };

  // ── Cargando / error / sin vehículo ──────────────────────────────────────────────────────────────────────────────────
  if (vehicles.data === undefined) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="MyVehicle">
        {vehicles.isLoading ? (
          <View testID="MyVehicle.loading" accessibilityLabel={copy.loading} accessibilityLiveRegion="polite" style={styles.loading}>
            <Skeleton height={172} radius={radii.lg} />
            <Skeleton height={44} radius={radii.md} style={styles.skeletonGap} />
            <Skeleton height={152} radius={radii.lg} style={styles.skeletonGap} />
            <Skeleton height={86} radius={radii.lg} style={styles.skeletonGap} />
            <Skeleton height={78} radius={radii.lg} style={styles.skeletonGap} />
          </View>
        ) : (
          <LoadFailure error={vehicles.error} onRetry={() => void vehicles.refetch()} testID="MyVehicle.error" />
        )}
      </Screen>
    );
  }

  if (vehicle === undefined) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="MyVehicle">
        <EmptyState
          testID="MyVehicle.empty"
          icon="car"
          title={copy.emptyTitle}
          message={copy.emptyMessage}
          actionLabel={copy.emptyAction}
          onAction={() => navigation.navigate("VehicleForm")}
        />
        {shownRows.length > 0 ? <Requirements rows={shownRows} onOpen={openTarget} showTitle /> : null}
      </Screen>
    );
  }

  const photoBusy = upload.busy !== null && upload.busy.kind === "vehicle_photo" ? upload.busy.label : null;
  const localPhoto = upload.localUri !== null && upload.localUri.kind === "vehicle_photo" ? upload.localUri.uri : null;
  const offline = vehicles.failedToRefresh || vehicles.isOffline;
  const modelOptions = modelsFor(editor.values.make);

  return (
    <>
      <Screen
        header={header}
        paddingX={DRIVER_SIDE}
        contentContainerStyle={frame}
        testID="MyVehicle"
        footer={
          <Button
            label={copy.save}
            loading={editor.isSaving}
            onPress={() => void onSave()}
            testID="MyVehicle.save"
            style={styles.save}
          />
        }
      >
        {offline ? <OfflineBanner testID="MyVehicle.offline" style={styles.gapBottom} /> : null}
        {upload.notice !== null ? (
          <View style={styles.gapBottom}>
            <NoticeBanner notice={upload.notice} testID="MyVehicle.notice" />
          </View>
        ) : null}
        {editor.banner !== null ? (
          <View style={styles.gapBottom}>
            <Banner kind="error" size="sm" title={editor.banner.title} message={editor.banner.message} testID="MyVehicle.saveError" />
          </View>
        ) : null}
        {vehicle.review_reason !== undefined && vehicle.review_reason !== null && vehicle.review_status === "rejected" ? (
          <View style={styles.gapBottom}>
            <Banner
              kind="error"
              size="sm"
              title={copy.reviewRejected}
              message={`${copy.reviewReason(vehicle.review_reason)} ${copy.reviewEditHint}`}
              testID="MyVehicle.rejected"
            />
          </View>
        ) : null}

        <VehiclePhotoCard
          vehicle={vehicle}
          localUri={localPhoto}
          busyLabel={photoBusy}
          onChange={() => upload.open("vehicle_photo", vehicle.id)}
        />

        <View style={styles.dataCard} testID="MyVehicle.data">
          <FieldRow
            label={copy.make}
            value={editor.values.make}
            placeholder={copy.makePlaceholder}
            onPress={() => setSheet("make")}
            error={editor.errors.make ?? null}
            testID="MyVehicle.make"
          />
          <View style={styles.rowGap} />
          <FieldRow
            label={copy.model}
            value={editor.values.model}
            placeholder={copy.modelPlaceholder}
            onPress={() => {
              if (editor.values.make.trim() === "") {
                showToast({ message: copy.modelNeedsMake, kind: "info" });
                setSheet("make");
                return;
              }
              setSheet("model");
            }}
            error={editor.errors.model ?? null}
            testID="MyVehicle.model"
          />
          <View style={styles.rowGap} />
          <FieldRow
            label={copy.plate}
            value={editor.values.plate}
            placeholder={copy.platePlaceholder}
            onChangeText={editor.setPlate}
            onBlur={() => editor.touch("plate")}
            maxLength={14}
            error={editor.errors.plate ?? null}
            testID="MyVehicle.plate"
          />
        </View>

        <View style={styles.seatsCard} testID="MyVehicle.seats">
          <View style={styles.seatsIcon}>
            <Icon name="car" size={40} color={colors.primary} />
          </View>
          <Text variant="rowTitle" color="deep" size={20.5} lineHeight={24.5} letterSpacing={-0.4} style={styles.seatsLabel}>
            {copy.seats}
          </Text>
          <PillStepper
            value={editor.values.seats}
            min={MIN_SEATS}
            max={MAX_SEATS}
            onChange={editor.setSeats}
            decrementLabel={copy.seatsMinusA11y}
            incrementLabel={copy.seatsPlusA11y}
            valueLabel={copy.seatsValueA11y(editor.values.seats)}
            testID="MyVehicle.seatsStepper"
          />
        </View>
        {editor.errors.seats !== undefined ? (
          <Text variant="caption" color="error" size={14} style={styles.seatsError}>
            {editor.errors.seats}
          </Text>
        ) : null}

        {readiness.data !== undefined ? (
          <Requirements rows={shownRows} onOpen={openTarget} showTitle={hasPendingRows(rows)} />
        ) : readiness.isLoading ? (
          <View style={styles.requirements} testID="MyVehicle.requirementsLoading" accessibilityLabel={copy.requirementsTitle}>
            <Skeleton height={78} radius={radii.lg} />
            <Skeleton height={78} radius={radii.lg} style={styles.skeletonGap} />
          </View>
        ) : (
          <View style={styles.requirements}>
            <Banner
              kind="warning"
              size="sm"
              title={copy.requirementsLoadError}
              message={describePublishError(readiness.error).message}
              actionLabel={publishStrings.common.retry}
              onAction={() => void readiness.refetch()}
              testID="MyVehicle.requirementsError"
            />
          </View>
        )}

        {others.length > 0 ? (
          <View style={styles.others} testID="MyVehicle.others">
            <Text variant="heading" color="heading" size={21} accessibilityRole="header">
              {copy.otherVehicles}
            </Text>
            {others.map((other) => (
              <ListRow
                key={other.id}
                title={vehicleName(other)}
                subtitle={other.plate}
                onPress={() => navigation.replace("MyVehicle", { vehicleId: other.id })}
                accessibilityLabel={copy.showVehicleA11y(`${vehicleName(other)} ${other.plate}`)}
                testID={`MyVehicle.other.${other.id}`}
                style={styles.otherRow}
              />
            ))}
          </View>
        ) : null}
        <Button
          label={copy.addAnother}
          variant="outline"
          size="sm"
          leadingIcon="add"
          chevron={false}
          onPress={() => navigation.navigate("VehicleForm")}
          testID="MyVehicle.addAnother"
          style={styles.addAnother}
        />
      </Screen>

      <ChoiceSheet
        visible={sheet === "make"}
        title={copy.makeSheetTitle}
        options={MAKE_NAMES}
        value={editor.values.make}
        onSelect={(make) => {
          editor.setMake(make);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="MyVehicle.makeSheet"
      />
      <ChoiceSheet
        visible={sheet === "model"}
        title={copy.modelSheetTitle}
        options={modelOptions}
        value={editor.values.model}
        onSelect={(model) => {
          editor.setModel(model);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="MyVehicle.modelSheet"
      />
      <UploadSourceSheet
        kind={upload.chooser?.kind ?? null}
        onChoose={(source) => void upload.choose(source)}
        onClose={upload.close}
        testID="MyVehicle.sourceSheet"
      />
      <ConfirmDialog
        visible={confirmSave}
        title={copy.confirmTitle}
        message={copy.confirmMessage}
        confirmLabel={copy.confirmAction}
        loading={editor.isSaving}
        onConfirm={() => void onConfirmSave()}
        onCancel={() => setConfirmSave(false)}
        testID="MyVehicle.confirmSave"
      />
      <ConfirmDialog
        visible={guard.visible}
        destructive
        title={copy.discardTitle}
        message={copy.discardMessage}
        confirmLabel={copy.discardAction}
        cancelLabel={copy.keepEditing}
        onConfirm={guard.leave}
        onCancel={guard.stay}
        testID="MyVehicle.discard"
      />
    </>
  );
}

interface RequirementsProps {
  rows: ReturnType<typeof visibleRows>;
  onOpen: (target: RequirementTarget) => void;
  showTitle: boolean;
}

/** Filas de requisitos bajo la tarjeta de plazas; con «Para poder publicar» encima mientras falte algo. */
function Requirements({ rows, onOpen, showTitle }: RequirementsProps): React.JSX.Element {
  return (
    <View style={styles.requirements} testID="MyVehicle.requirements">
      {showTitle ? (
        <Text variant="heading" color="heading" size={21} accessibilityRole="header" style={styles.requirementsTitle}>
          {copy.requirementsTitle}
        </Text>
      ) : null}
      {rows.map((row, index) => (
        <View key={row.key} style={index > 0 ? styles.requirementGap : null}>
          <RequirementRow row={row} onPress={() => onOpen(row.target)} testID={`MyVehicle.requirement.${row.key}`} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingHorizontal: 0 },
  skeletonGap: { marginTop: 10 },
  gapBottom: { marginBottom: 10 },
  dataCard: {
    marginTop: 10,
    paddingTop: 11,
    paddingBottom: 11.5,
    paddingLeft: 14,
    paddingRight: 11,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tint,
  },
  rowGap: { height: 9 },
  seatsCard: {
    marginTop: 11.5,
    minHeight: 86.5,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 4.5,
    paddingRight: 9,
    borderRadius: radii.lg,
    backgroundColor: colors.bg.tint,
  },
  seatsIcon: {
    width: 57,
    height: 57,
    borderRadius: 28.5,
    backgroundColor: colors.bg.white,
    alignItems: "center",
    justifyContent: "center",
  },
  seatsLabel: { flex: 1, marginLeft: 11, marginRight: 6 },
  seatsError: { marginTop: 4, marginLeft: 6 },
  requirements: { marginTop: 11.5 },
  requirementsTitle: { marginBottom: 8, marginLeft: 2 },
  requirementGap: { marginTop: 12 },
  others: { marginTop: 36 },
  otherRow: { marginTop: 8 },
  addAnother: { marginTop: 16, alignSelf: "center" },
  save: { height: 48, borderRadius: radii.md, marginBottom: 3 },
});
