/**
 * Visor de documentación privada: aviso previo («el acceso queda registrado») y, tras aceptarlo, la imagen con cuenta
 * atrás de 2 minutos. Al caducar, al cerrar o al salir de la app la imagen se retira de la pantalla. No se guarda ni se
 * comparte: sin botón de descargar y sin caché. Todo el comportamiento vive en `useEvidenceViewer`.
 */
import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { formatCountdown } from "@/i18n";
import { colors } from "@/theme";
import { Banner, BottomSheet, Button, ConfirmDialog, Spinner, Text } from "@/ui";
import type { EvidenceViewer } from "../hooks/useEvidenceViewer";
import { reviewStrings } from "../strings";

const e = reviewStrings.evidence;

export function EvidenceViewerSheet({ viewer, testID = "EvidenceViewer" }: { viewer: EvidenceViewer; testID?: string }): React.JSX.Element {
  const target = viewer.target;
  const failure = viewer.error;
  const footer = (
    <View style={styles.actions}>
      {viewer.status === "expired" || viewer.status === "error" ? <Button testID={`${testID}.reopen`} label={e.reopen} chevron={false} onPress={viewer.reopen} /> : null}
      <Button testID={`${testID}.close`} label={e.close} variant="outline" chevron={false} onPress={viewer.close} />
    </View>
  );
  return (
    <>
      <ConfirmDialog
        visible={viewer.phase === "notice"}
        title={e.noticeTitle}
        message={target !== null ? e.noticeMessage(target.ownerName) : undefined}
        confirmLabel={e.noticeOpen}
        icon="lock"
        onConfirm={viewer.confirm}
        onCancel={viewer.close}
        testID={`${testID}.notice`}
      />
      <BottomSheet visible={viewer.phase === "open"} onClose={viewer.close} title={target?.title ?? e.viewerTitle} subtitle={e.accessLogged} footer={footer} testID={`${testID}.sheet`}>
        {viewer.status === "requesting" || viewer.status === "loading" ? (
          <View style={styles.center} testID={`${testID}.loading`} accessible accessibilityLabel={viewer.status === "requesting" ? e.requesting : e.loadingImage}>
            <Spinner />
            <Text variant="body" color="muted" size={15} style={styles.gap}>{viewer.status === "requesting" ? e.requesting : e.loadingImage}</Text>
          </View>
        ) : null}
        {viewer.status === "ready" ? (
          <View>
            <Text variant="titleSm" color="warning" size={16} align="center" accessibilityLiveRegion="polite" testID={`${testID}.countdown`}>{e.expiresIn(formatCountdown(viewer.secondsLeft))}</Text>
            {viewer.isImage && viewer.imageUri !== null ? (
              <Image testID={`${testID}.image`} source={{ uri: viewer.imageUri }} accessibilityLabel={target?.title ?? e.viewerTitle} resizeMode="contain" style={styles.image} />
            ) : (
              <Text variant="body" color="body" size={15.5} style={styles.gap}>{e.notImage(viewer.contentType ?? "—")}</Text>
            )}
          </View>
        ) : null}
        {viewer.status === "expired" ? <Banner kind="notice" message={e.expired} testID={`${testID}.expired`} /> : null}
        {viewer.status === "error" && failure !== null ? <Banner kind="error" title={failure.title} message={failure.message} testID={`${testID}.error`} /> : null}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  center: { alignItems: "center", paddingVertical: 28 },
  gap: { marginTop: 10 },
  image: { width: "100%", height: 280, marginTop: 12, borderRadius: 12, backgroundColor: colors.bg.tint },
});
