/**
 * «Detalle de la incidencia»: categoría, estado con su explicación, lo que la persona contó, las fotos adjuntas (y subir
 * más mientras siga abierta) y la referencia para hablar con el equipo. Nunca promete un resultado: solo muestra el
 * estado real que el equipo de MVC ha puesto. Estados: cargando · no existe · error · abierta · en revisión · resuelta ·
 * descartada · subiendo foto · permiso de cámara denegado/bloqueado.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { LiveIncidentReport } from "@/api/types";
import { formatDateTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { openAppSettings } from "@/platform";
import { Banner, Button, Card, KeyValueRow, OptionSheet, Screen, ScreenHeader, SectionHeader, Skeleton, StatusPill, Text, type StatusTone } from "@/ui";
import { LoadError } from "../components/LoadError";
import { MAX_INCIDENT_PHOTOS, pickIncidentPhoto, uploadIncidentPhoto, type PhotoSource } from "../hooks/useIncidentPhotos";
import { useMyIncident } from "../hooks/useIncidents";
import { liveStrings } from "../strings";

const T = liveStrings.incidents;
const R = liveStrings.report;
const SIDE = 14;

const TONE: Record<LiveIncidentReport["status"], StatusTone> = { open: "amber", in_review: "blue", resolved: "green", dismissed: "gray" };

const sizeLabel = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function IncidentDetailScreen({ navigation, route }: AppScreenProps<"IncidentDetail">): React.JSX.Element {
  const { reportId } = route.params;
  const query = useMyIncident(reportId);
  const report = query.data;
  const [sheet, setSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "warning"; message: string; settings: boolean } | null>(null);
  const header = <ScreenHeader title={T.detailTitle} testID="IncidentDetail.header" />;

  if (report === undefined) {
    const notFound = query.error ? describeError(query.error).status === 404 : false;
    return (
      <Screen testID="IncidentDetail" paddingX={SIDE} header={header}>
        <View style={styles.block}>
          {query.error ? (
            <LoadError
              error={query.error}
              onRetry={() => void query.refetch()}
              fallbackLabel={T.backToList}
              onFallback={() => navigation.navigate("IncidentReports")}
              testID={notFound ? "IncidentDetail.notFound" : "IncidentDetail.error"}
            />
          ) : (
            <View testID="IncidentDetail.loading" accessible accessibilityLabel={T.loading} accessibilityState={{ busy: true }}>
              <Skeleton height={72} radius={14} />
              <Skeleton height={120} radius={14} style={styles.gap} />
              <Skeleton height={90} radius={14} style={styles.gap} />
            </View>
          )}
        </View>
      </Screen>
    );
  }

  const closed = report.status === "resolved" || report.status === "dismissed";
  const canAdd = !closed && report.attachments.length < MAX_INCIDENT_PHOTOS;

  const addPhoto = async (source: PhotoSource): Promise<void> => {
    setSheet(false);
    setNotice(null);
    const picked = await pickIncidentPhoto(source);
    switch (picked.status) {
      case "cancelled":
        return;
      case "denied":
        setNotice({ kind: "warning", message: R.photoDenied, settings: false });
        return;
      case "blocked":
        setNotice({ kind: "warning", message: R.photoBlocked, settings: true });
        return;
      case "unavailable":
        setNotice({ kind: "warning", message: R.photoUnavailable, settings: false });
        return;
      case "invalid":
        setNotice({ kind: "warning", message: picked.reason === "type" ? R.photoType : R.photoSize, settings: false });
        return;
      case "picked": {
        setUploading(true);
        const outcome = await uploadIncidentPhoto(report.id, picked.photo);
        setUploading(false);
        if (!outcome.ok) setNotice({ kind: "error", message: describeError(outcome.error).message, settings: false });
        else void query.refetch();
      }
    }
  };

  return (
    <Screen testID="IncidentDetail" paddingX={SIDE} header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <View style={styles.block}>
        <View style={styles.head}>
          <View style={styles.flex}>
            <Text variant="titleSm" color="heading" size={24} lineHeight={29} testID="IncidentDetail.category">{R.categories[report.category]}</Text>
            <Text variant="body" color="muted" size={14.5} testID="IncidentDetail.reference">{T.reference(report.id)}</Text>
          </View>
          <StatusPill testID="IncidentDetail.status" label={T.status[report.status]} tone={TONE[report.status]} />
        </View>

        <Banner testID="IncidentDetail.statusHelp" kind={report.status === "resolved" ? "success" : report.status === "open" ? "warning" : "notice"} size="sm" title={T.statusHelp[report.status]} style={styles.gap} />

        <Card padding={12} style={styles.gap}>
          <KeyValueRow label={T.sentLabel} value={formatDateTime(report.createdAt)} />
          <KeyValueRow label={T.updatedLabel} value={formatDateTime(report.updatedAt)} />
          <KeyValueRow label={T.roleLabel} value={report.reporterRole === "driver" ? T.roleDriver : T.rolePassenger} />
        </Card>

        <SectionHeader title={T.descriptionTitle} style={styles.section} />
        <Card padding={14}>
          <Text testID="IncidentDetail.description" variant="body" color="strong" size={16.5} lineHeight={22}>{report.description}</Text>
        </Card>

        <SectionHeader title={T.attachmentsTitle} style={styles.section} />
        {report.attachments.length === 0 ? (
          <Text testID="IncidentDetail.noPhotos" variant="body" color="muted" size={15}>{T.noPhotos}</Text>
        ) : (
          report.attachments.map((attachment, index) => (
            <Card key={attachment.id} padding={12} style={index === 0 ? undefined : styles.gapSm} testID={`IncidentDetail.attachment.${index + 1}`}>
              <View style={styles.attachment}>
                <View style={styles.flex}>
                  <Text variant="rowTitle" color="heading" size={16}>{T.photoN(index + 1)}</Text>
                  <Text variant="body" color="muted" size={14}>{sizeLabel(attachment.sizeBytes)}</Text>
                </View>
                <StatusPill label={attachment.status === "uploaded" ? T.attachmentUploaded : T.attachmentPending} tone={attachment.status === "uploaded" ? "green" : "amber"} size="sm" />
              </View>
            </Card>
          ))
        )}

        {notice ? (
          <Banner testID="IncidentDetail.notice" kind={notice.kind} size="sm" title={notice.message} style={styles.gap}>
            {notice.settings ? <Button testID="IncidentDetail.openSettings" label={R.openSettings} variant="outline" size="sm" chevron={false} onPress={() => void openAppSettings()} style={styles.gapSm} /> : null}
          </Banner>
        ) : null}

        {canAdd ? (
          <Button testID="IncidentDetail.addPhoto" label={T.addPhoto} variant="outline" leadingIcon="camera" chevron={false} loading={uploading} onPress={() => setSheet(true)} style={styles.gap} />
        ) : closed ? (
          <Text testID="IncidentDetail.closedNote" variant="body" color="muted" size={14.5} style={styles.gap}>{T.closedNote}</Text>
        ) : (
          <Text testID="IncidentDetail.photosLimit" variant="body" color="muted" size={14.5} style={styles.gap}>{R.photosLimit}</Text>
        )}

        <Button testID="IncidentDetail.backToList" label={T.backToList} variant="ghost" chevron={false} onPress={() => navigation.navigate("IncidentReports")} style={styles.gap} />
      </View>

      <OptionSheet<PhotoSource>
        visible={sheet}
        title={R.photoSheetTitle}
        options={[
          { value: "camera", label: R.photoTake, icon: "camera" },
          { value: "library", label: R.photoLibrary, icon: "image" },
        ]}
        onSelect={(source) => void addPhoto(source)}
        onClose={() => setSheet(false)}
        testID="IncidentDetail.photoSheet"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 24 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  gap: { marginTop: 12 },
  gapSm: { marginTop: 8 },
  section: { marginTop: 18 },
  attachment: { flexDirection: "row", alignItems: "center", gap: 10 },
});
