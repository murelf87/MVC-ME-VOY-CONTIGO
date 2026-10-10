/**
 * Descargar mis datos (RGPD): pedir una copia en JSON, ver el estado real de cada solicitud (en cola · preparando · lista ·
 * caducada · fallida · no disponible) y descargarla con un enlace firmado de corta duración que solo se pide al pulsar.
 * Una copia cada 24 h: el límite se explica, no se oculta.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError, isApiErrorWithCode, isOfflineError } from "@/api";
import type { DataExportDownload, DataExportRequest } from "@/api/types";
import { formatDateShort, formatTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation/types";
import { copyToClipboard, openWebPage } from "@/platform";
import { colors } from "@/theme";
import { Banner, BottomSheet, Button, EmptyState, Screen, ScreenHeader, StatusPill, Text, showToast, type StatusTone } from "@/ui";
import { ListSkeleton, LoadError } from "../components/StateCards";
import { getDataExportDownload } from "../api";
import { useDataExports, useRequestDataExport } from "../hooks/useAccountData";
import { helpStrings } from "../strings";

const t = helpStrings.exports;
const TONE: Record<DataExportRequest["status"], StatusTone> = { queued: "amber", processing: "amber", ready: "green", failed: "red", blocked_storage_disabled: "gray", expired: "gray" };

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function DataExportsScreen({ navigation }: AppScreenProps<"DataExports">): React.JSX.Element {
  const [polling, setPolling] = useState(false);
  const list = useDataExports(true, polling);
  const request = useRequestDataExport();
  const [link, setLink] = useState<DataExportDownload | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const open = list.items.some((item) => item.status === "queued" || item.status === "processing");
  if (open !== polling) setPolling(open);

  const ask = async (): Promise<void> => {
    setRateLimited(false);
    try {
      await request.mutateAsync();
      showToast({ kind: "success", message: t.requestedToast, id: "export.request" });
      void list.refresh();
    } catch (error) {
      if (isApiErrorWithCode(error, "EXPORT_RATE_LIMITED")) setRateLimited(true);
      else showToast({ kind: "error", message: describeError(error).message, id: "export.request" });
    }
  };

  const download = async (id: string): Promise<void> => {
    setFetching(id);
    try {
      setLink(await getDataExportDownload(id));
    } catch (error) {
      showToast({ kind: "error", message: describeError(error).message, id: "export.download" });
      void list.refresh();
    } finally {
      setFetching(null);
    }
  };

  const openLink = async (): Promise<void> => {
    if (link === null) return;
    const outcome = await openWebPage(link.url);
    if (outcome !== "opened") showToast({ kind: "error", message: t.downloadOpenFailed, id: "export.open" });
  };
  const copyLink = async (): Promise<void> => {
    if (link === null) return;
    const ok = await copyToClipboard(link.url);
    showToast({ kind: ok ? "success" : "error", message: ok ? t.downloadLinkCopied : t.downloadOpenFailed, id: "export.copy" });
  };

  return (
    <Screen testID="DataExports" header={<ScreenHeader title={t.title} testID="DataExports.header" />} refreshing={list.isRefreshing} onRefresh={() => void list.refresh()}>
      <Text variant="body" color="body" size={16.5} lineHeight={22}>{t.intro}</Text>
      {rateLimited ? <Banner testID="DataExports.rateLimited" kind="warning" title={t.rateLimitedTitle} message={t.rateLimitedMessage} style={styles.gap} /> : null}
      <Button testID="DataExports.request" label={request.isPending ? t.requesting : t.request} chevron={false} loading={request.isPending} onPress={() => void ask()} style={styles.gap} />
      <Text variant="body" color="muted" size={14.5} style={styles.gapSmall} testID="DataExports.note">{t.privacyNote}</Text>

      <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.section}>{t.historyTitle}</Text>
      {open ? <Text variant="body" color="muted" size={14.5} testID="DataExports.poll">{t.pollNote}</Text> : null}
      {list.items.length === 0 && list.isLoading ? <ListSkeleton testID="DataExports.loading" count={2} /> : null}
      {list.items.length === 0 && (list.isError || list.isOffline) ? <LoadError testID="DataExports.error" title={t.loadErrorTitle} offline={isOfflineError(list.error) || list.isOffline} onRetry={() => void list.refresh()} /> : null}
      {list.isEmpty ? <EmptyState testID="DataExports.empty" icon="documentOutline" variant="plain" title={t.historyEmpty} message="" /> : null}
      {list.items.map((item) => (
        <View key={item.id} style={styles.card} testID={`DataExports.item.${item.id}`}>
          <View style={styles.head}>
            <Text variant="titleSm" color="heading" size={17.5} style={styles.flex}>{t.requestedAt(formatDateShort(item.requestedAt))}</Text>
            <StatusPill label={t.status[item.status]} tone={TONE[item.status]} size="sm" />
          </View>
          <Text variant="body" color="body" size={15.5}>{t.statusHint[item.status]}</Text>
          {item.status === "ready" && item.expiresAt !== null ? <Text variant="body" color="muted" size={14.5}>{t.availableUntil(formatDateShort(item.expiresAt))}</Text> : null}
          {item.status === "expired" && item.expiresAt !== null ? <Text variant="body" color="muted" size={14.5}>{t.expiredOn(formatDateShort(item.expiresAt))}</Text> : null}
          {item.sizeBytes !== null && item.status === "ready" ? <Text variant="body" color="muted" size={14.5}>{t.sizeLabel(sizeText(item.sizeBytes))}</Text> : null}
          {item.downloadable && item.status === "ready" ? (
            <Button testID={`DataExports.download.${item.id}`} label={fetching === item.id ? t.downloading : t.download} size="sm" chevron={false} loading={fetching === item.id} onPress={() => void download(item.id)} style={styles.gapSmall} />
          ) : null}
        </View>
      ))}
      {list.hasMore ? <Button testID="DataExports.more" label={helpStrings.common.continue} variant="outline" chevron={false} loading={list.isFetchingMore} onPress={() => void list.fetchMore()} style={styles.gap} /> : null}
      <Text variant="body" color="muted" size={14} style={styles.gap} testID="DataExports.downloadNote">{t.downloadNote}</Text>

      <BottomSheet
        visible={link !== null}
        onClose={() => setLink(null)}
        title={t.downloadSheetTitle}
        testID="DataExports.sheet"
        footer={<Button testID="DataExports.sheet.close" label={helpStrings.common.close} variant="outline" chevron={false} onPress={() => setLink(null)} />}
      >
        {link !== null ? <Text variant="body" color="body" size={16.5}>{t.downloadSheetMessage(formatTime(link.expiresAt))}</Text> : null}
        <Button testID="DataExports.sheet.open" label={t.downloadOpen} chevron={false} onPress={() => void openLink()} style={styles.gap} />
        <Button testID="DataExports.sheet.copy" label={t.downloadCopyLink} variant="outline" chevron={false} onPress={() => void copyLink()} style={styles.gapSmall} />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginTop: 14 },
  gapSmall: { marginTop: 8 },
  section: { marginTop: 24, marginBottom: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  card: { marginTop: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 4 },
});
