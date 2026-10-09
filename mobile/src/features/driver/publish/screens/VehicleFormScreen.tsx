import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { useAppNavigation, useAppRoute } from "@/navigation";
import { colors, radii } from "@/theme";
import { Banner, Button, ConfirmDialog, EmptyState, OfflineBanner, Screen, Skeleton, Text, showToast } from "@/ui";
import { ChoiceSheet } from "../components/ChoiceSheet";
import { DriverHeader } from "../components/DriverHeader";
import { FieldRow } from "../components/FieldRow";
import { LoadFailure } from "../components/LoadFailure";
import { PillStepper } from "../components/PillStepper";
import { DRIVER_SIDE, DRIVER_TOP_GAP } from "../components/metrics";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { useVehicleEditor } from "../hooks/useVehicleEditor";
import { useVehicles } from "../hooks/useVehicles";
import { MAKE_NAMES, MAX_SEATS, MIN_SEATS, modelsFor } from "../logic/vehicle";
import { publishStrings } from "../strings";

const copy = publishStrings.vehicle;
const titles = { create: "Añadir vehículo", edit: "Datos del vehículo" } as const;

/**
 * «Datos del vehículo»: alta de un vehículo nuevo o edición de uno existente (marca, modelo, matrícula, color y plazas).
 * Editar un vehículo aprobado reinicia su revisión: se avisa antes de guardar. Tras un alta se pasa a subir su documentación.
 */
export function VehicleFormScreen(): React.JSX.Element {
  const navigation = useAppNavigation();
  const { params } = useAppRoute("VehicleForm");
  const vehicleId = params?.vehicleId;
  const vehicles = useVehicles();
  const vehicle = vehicleId === undefined ? undefined : vehicles.data?.find((v) => v.id === vehicleId);
  const editor = useVehicleEditor(vehicle, { withColor: true });
  const guard = useUnsavedGuard(editor.dirty);
  const [sheet, setSheet] = React.useState<"make" | "model" | null>(null);
  const [confirmSave, setConfirmSave] = React.useState(false);

  const header = <DriverHeader title={vehicleId === undefined ? titles.create : titles.edit} testID="VehicleForm.header" />;
  const frame = { paddingTop: DRIVER_TOP_GAP } as const;

  if (vehicleId !== undefined && vehicles.data === undefined) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="VehicleForm">
        {vehicles.isLoading ? (
          <View testID="VehicleForm.loading" accessibilityLabel={copy.loading} accessibilityLiveRegion="polite">
            <Skeleton height={190} radius={radii.lg} />
            <Skeleton height={70} radius={radii.lg} style={styles.gap} />
          </View>
        ) : (
          <LoadFailure error={vehicles.error} onRetry={() => void vehicles.refetch()} testID="VehicleForm.error" />
        )}
      </Screen>
    );
  }

  if (vehicleId !== undefined && vehicle === undefined) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="VehicleForm">
        <EmptyState
          testID="VehicleForm.missing"
          icon="car"
          title={publishStrings.documents.vehicleMissingTitle}
          message={publishStrings.documents.vehicleMissingMessage}
          actionLabel={publishStrings.documents.vehicleMissingAction}
          onAction={() => navigation.replace("MyVehicle")}
        />
      </Screen>
    );
  }

  const finish = (saved: { id: string }, created: boolean, review: boolean): void => {
    guard.release();
    showToast({ message: created ? copy.created : review ? copy.savedReview : copy.saved, kind: "success" });
    if (created) navigation.replace("VehicleDocuments", { vehicleId: saved.id });
    else navigation.goBack();
  };

  const onSave = async (confirmed = false): Promise<void> => {
    const outcome = await editor.submit({ confirmed });
    setConfirmSave(false);
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
        finish(outcome.vehicle, outcome.created, confirmed);
        return;
      case "failed":
        return;
    }
  };

  const offline = vehicles.failedToRefresh || vehicles.isOffline;

  return (
    <>
      <Screen
        header={header}
        paddingX={DRIVER_SIDE}
        contentContainerStyle={frame}
        testID="VehicleForm"
        footer={
          <Button
            label={vehicle === undefined ? copy.create : copy.save}
            loading={editor.isSaving}
            onPress={() => void onSave()}
            testID="VehicleForm.save"
            style={styles.save}
          />
        }
      >
        {offline ? <OfflineBanner testID="VehicleForm.offline" style={styles.gapBottom} /> : null}
        {editor.banner !== null ? (
          <Banner kind="error" size="sm" title={editor.banner.title} message={editor.banner.message} style={styles.gapBottom} testID="VehicleForm.saveError" />
        ) : null}
        {vehicle === undefined ? (
          <Banner kind="info" size="sm" message={copy.emptyMessage} style={styles.gapBottom} testID="VehicleForm.intro" />
        ) : null}

        <View style={styles.card} testID="VehicleForm.data">
          <FieldRow label={copy.make} value={editor.values.make} placeholder={copy.makePlaceholder} onPress={() => setSheet("make")} error={editor.errors.make ?? null} testID="VehicleForm.make" />
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
            testID="VehicleForm.model"
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
            testID="VehicleForm.plate"
          />
          <View style={styles.rowGap} />
          <FieldRow
            label={copy.color}
            value={editor.values.color}
            placeholder={copy.colorPlaceholder}
            onChangeText={editor.setColor}
            onBlur={() => editor.touch("color")}
            autoCapitalize="words"
            maxLength={40}
            error={editor.errors.color ?? null}
            testID="VehicleForm.color"
          />
        </View>

        <View style={styles.seatsCard} testID="VehicleForm.seats">
          <View style={styles.seatsIcon}>
            <Icon name="car" size={40} color={colors.primary} />
          </View>
          <View style={styles.seatsText}>
            <Text variant="rowTitle" color="deep" size={20} lineHeight={24} letterSpacing={-0.4}>
              {copy.seats}
            </Text>
            <Text variant="caption" color="muted" size={14}>{copy.seatsHint}</Text>
          </View>
          <PillStepper
            value={editor.values.seats}
            min={MIN_SEATS}
            max={MAX_SEATS}
            onChange={editor.setSeats}
            decrementLabel={copy.seatsMinusA11y}
            incrementLabel={copy.seatsPlusA11y}
            valueLabel={copy.seatsValueA11y(editor.values.seats)}
            size="compact"
            testID="VehicleForm.seatsStepper"
          />
        </View>
        {editor.errors.seats !== undefined ? (
          <Text variant="caption" color="error" size={14} accessibilityRole="alert" style={styles.seatsError}>{editor.errors.seats}</Text>
        ) : null}
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
        testID="VehicleForm.makeSheet"
      />
      <ChoiceSheet
        visible={sheet === "model"}
        title={copy.modelSheetTitle}
        options={modelsFor(editor.values.make)}
        value={editor.values.model}
        onSelect={(model) => {
          editor.setModel(model);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="VehicleForm.modelSheet"
      />
      <ConfirmDialog
        visible={confirmSave}
        title={copy.confirmTitle}
        message={copy.confirmMessage}
        confirmLabel={copy.confirmAction}
        cancelLabel={copy.keepEditing}
        onConfirm={() => void onSave(true)}
        onCancel={() => setConfirmSave(false)}
        testID="VehicleForm.confirm"
      />
      <ConfirmDialog
        visible={guard.visible}
        title={copy.discardTitle}
        message={copy.discardMessage}
        confirmLabel={copy.discardAction}
        cancelLabel={copy.keepEditing}
        destructive
        onConfirm={guard.leave}
        onCancel={guard.stay}
        testID="VehicleForm.discard"
      />
    </>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 10 },
  gapBottom: { marginBottom: 10 },
  save: { marginTop: 4 },
  card: { backgroundColor: colors.bg.tint, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 14 },
  rowGap: { height: 12 },
  seatsCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bg.tint, borderRadius: radii.lg, padding: 12, marginTop: 10 },
  seatsIcon: { width: 52, alignItems: "center" },
  seatsText: { flex: 1, marginHorizontal: 8 },
  seatsError: { marginTop: 6, paddingHorizontal: 6 },
});
