import React from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/icons";
import { todayIso } from "@/features/search/browse/logic/schedule";
import { useAppNavigation, useAppRoute } from "@/navigation";
import { colors, radii } from "@/theme";
import { Banner, Button, EmptyState, OfflineBanner, Screen, Skeleton, StatusPill, Text, showToast, type StatusTone } from "@/ui";
import { DriverHeader } from "../components/DriverHeader";
import { LoadFailure } from "../components/LoadFailure";
import { NoticeBanner } from "../components/NoticeBanner";
import { UploadSourceSheet } from "../components/UploadSourceSheet";
import { DRIVER_SIDE, DRIVER_TOP_GAP } from "../components/metrics";
import { getDocumentDownloadUrl } from "../api";
import { useDriverReadiness } from "../hooks/useDriverReadiness";
import { useUploadFlow } from "../hooks/useUploadFlow";
import { useDocuments, useVehicles } from "../hooks/useVehicles";
import { buildSections, type DocSection, type DocTone } from "../logic/documents";
import { describePublishError } from "../logic/errors";
import { vehicleName } from "../logic/vehicle";
import { publishStrings } from "../strings";

const copy = publishStrings.documents;
const PILL: Record<DocTone, StatusTone> = { success: "green", warning: "amber", danger: "red", neutral: "blue" };
const ICON: Record<DocSection["key"], IconName> = { photo: "image", insurance: "shield", license: "idCard", data: "car" };

/**
 * «Documentación del vehículo»: la foto, el seguro, el permiso de conducir y los datos, cada uno con su estado de revisión
 * (lo decide el equipo de revisión, no la app) y su acción: subir o cambiar el archivo, verlo o editar los datos.
 */
export function VehicleDocumentsScreen(): React.JSX.Element {
  const navigation = useAppNavigation();
  const { params } = useAppRoute("VehicleDocuments");
  const vehicles = useVehicles();
  const documents = useDocuments();
  const readiness = useDriverReadiness();
  const upload = useUploadFlow();
  const [opening, setOpening] = React.useState<string | null>(null);
  const vehicle = vehicles.data?.find((v) => v.id === params?.vehicleId);

  const header = <DriverHeader title={copy.title} testID="VehicleDocuments.header" />;
  const frame = { paddingTop: DRIVER_TOP_GAP } as const;

  if (vehicles.data === undefined) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="VehicleDocuments">
        {vehicles.isLoading ? (
          <View testID="VehicleDocuments.loading" accessibilityLabel={copy.loading} accessibilityLiveRegion="polite">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={110} radius={radii.lg} style={i > 0 ? styles.gap : undefined} />
            ))}
          </View>
        ) : (
          <LoadFailure error={vehicles.error} onRetry={() => void vehicles.refetch()} testID="VehicleDocuments.error" />
        )}
      </Screen>
    );
  }

  if (vehicle === undefined) {
    return (
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="VehicleDocuments">
        <EmptyState
          testID="VehicleDocuments.missing"
          icon="car"
          title={copy.vehicleMissingTitle}
          message={copy.vehicleMissingMessage}
          actionLabel={copy.vehicleMissingAction}
          onAction={() => navigation.replace("MyVehicle")}
        />
      </Screen>
    );
  }

  const sections = buildSections({ vehicle, documents: documents.data ?? [], readiness: readiness.data?.items, todayIso: todayIso(new Date()) });

  const viewFile = async (documentId: string): Promise<void> => {
    setOpening(documentId);
    try {
      const signed = await getDocumentDownloadUrl(documentId);
      await Linking.openURL(signed.url);
    } catch (raised) {
      const view = describePublishError(raised);
      showToast({ message: view.offline ? publishStrings.common.offlineAction : copy.openError, kind: "error" });
    } finally {
      setOpening(null);
    }
  };

  const onAction = (section: DocSection): void => {
    if (section.action === null) return;
    if (section.action.kind === "edit") {
      navigation.navigate("VehicleForm", { vehicleId: vehicle.id });
      return;
    }
    if (section.uploadKind !== null) upload.open(section.uploadKind, section.uploadKind === "driver_license" ? null : vehicle.id);
  };

  const busyKind = upload.busy?.kind ?? null;
  const offline = vehicles.failedToRefresh || vehicles.isOffline;

  return (
    <>
      <Screen header={header} paddingX={DRIVER_SIDE} contentContainerStyle={frame} testID="VehicleDocuments">
        {offline ? <OfflineBanner testID="VehicleDocuments.offline" style={styles.gapBottom} /> : null}
        <Text variant="rowTitle" color="deep" size={19} lineHeight={24} style={styles.vehicleLine} testID="VehicleDocuments.vehicle">
          {copy.vehicleLine(vehicleName(vehicle), vehicle.plate)}
        </Text>
        {upload.notice !== null ? (
          <View style={styles.gapBottom}>
            <NoticeBanner notice={upload.notice} testID="VehicleDocuments.notice" />
          </View>
        ) : null}
        {sections.map((section) => {
          const busy = busyKind !== null && busyKind === section.uploadKind;
          return (
            <View key={section.key} style={styles.card} testID={`VehicleDocuments.${section.key}`} accessible accessibilityLabel={section.accessibilityLabel}>
              <View style={styles.cardTop}>
                <View style={styles.disc}>
                  <Icon name={ICON[section.key]} size={26} color={colors.primary} />
                </View>
                <Text variant="rowTitle" color="deep" size={18.5} lineHeight={23} letterSpacing={-0.3} style={styles.cardTitle} numberOfLines={2}>
                  {section.title}
                </Text>
                <StatusPill label={section.statusLabel} tone={PILL[section.tone]} size="sm" />
              </View>
              {section.lines.map((line) => (
                <Text key={line} variant="body" color={section.tone === "danger" ? "error" : "heading"} size={15.5} lineHeight={20} style={styles.line}>
                  {line}
                </Text>
              ))}
              <Text variant="caption" color="muted" size={14} lineHeight={18} style={styles.help}>
                {section.help}
              </Text>
              <View style={styles.actions}>
                {section.action !== null ? (
                  <Button
                    label={busy ? (upload.busy?.label ?? "") : section.action.label}
                    variant={section.status === "none" || section.status === "rejected" || section.status === "expired" ? "primary" : "outline"}
                    size="sm"
                    chevron={false}
                    loading={busy}
                    disabled={upload.busy !== null && !busy}
                    onPress={() => onAction(section)}
                    testID={`VehicleDocuments.${section.key}.action`}
                    style={styles.actionButton}
                  />
                ) : null}
                {section.documentId !== null ? (
                  <Button
                    label={copy.viewFile}
                    variant="ghost"
                    size="sm"
                    chevron={false}
                    loading={opening === section.documentId}
                    onPress={() => void viewFile(section.documentId as string)}
                    testID={`VehicleDocuments.${section.key}.view`}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
        <Banner kind="info" icon="lock" size="sm" message={copy.privacyNote} style={styles.gapTop} testID="VehicleDocuments.privacy" />
      </Screen>
      <UploadSourceSheet kind={upload.chooser?.kind ?? null} onChoose={(source) => void upload.choose(source)} onClose={upload.close} testID="VehicleDocuments.sourceSheet" />
    </>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 10 },
  gapBottom: { marginBottom: 10 },
  gapTop: { marginTop: 12 },
  vehicleLine: { marginBottom: 10, paddingHorizontal: 4 },
  card: { backgroundColor: colors.bg.tint, borderRadius: radii.lg, padding: 12, marginBottom: 10 },
  cardTop: { flexDirection: "row", alignItems: "center" },
  disc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bg.white, alignItems: "center", justifyContent: "center" },
  cardTitle: { flex: 1, marginHorizontal: 10 },
  line: { marginTop: 6 },
  help: { marginTop: 6 },
  actions: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  actionButton: { flexShrink: 1, marginRight: 8 },
});
