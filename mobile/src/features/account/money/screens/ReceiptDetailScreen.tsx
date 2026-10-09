/**
 * Recibo (justificante no fiscal): número, tipo, fecha, viaje, desglose con el total, aviso legal del servidor y acciones
 * reales: compartir (hoja del sistema), copiar el número y ver la versión imprimible. Los importes salen del servidor
 * («Por definir» sin tarifa aprobada). Estados: cargando · error · no existe · sin conexión.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { ApiError } from "@/api";
import { formatDateTime } from "@/i18n";
import { copyToClipboard, shareContent } from "@/platform";
import type { AppScreenProps } from "@/navigation";
import { Banner, Button, Divider, EmptyState, Screen, ScreenHeader, Text, showToast } from "@/ui";
import { DetailCard, DetailRow } from "../components/ListBits";
import { PrintableSheet } from "../components/PrintableSheet";
import { LoadError, RowsSkeleton, StaleNote } from "../components/StateBlocks";
import { useReceipt, useReceiptPrintable } from "../hooks/useReceipts";
import { receiptKindLabel, receiptLineLabel, receiptShareText, receiptTotalLabel, receiptTotalText, tripRouteText, withPerson } from "../model";
import { moneyStrings } from "../strings";

const t = moneyStrings.receipt;

export function ReceiptDetailScreen({ navigation, route }: AppScreenProps<"ReceiptDetail">): React.JSX.Element {
  const { receiptId } = route.params;
  const query = useReceipt(receiptId);
  const [printOpen, setPrintOpen] = useState(false);
  const printable = useReceiptPrintable(receiptId, printOpen);
  const header = <ScreenHeader title={t.title} testID="ReceiptDetail.header" />;
  const receipt = query.data;

  if (receipt === undefined) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Screen testID="ReceiptDetail" header={header}>
        {notFound ? (
          <EmptyState testID="ReceiptDetail.notFound" icon="alertCircle" title={t.notFound} message="" actionLabel={moneyStrings.refunds.close} onAction={() => navigation.goBack()} variant="plain" />
        ) : query.isError || query.isOffline ? (
          <LoadError testID="ReceiptDetail.error" error={query.error} heading={t.loadError} onRetry={() => void query.refetch()} />
        ) : (
          <RowsSkeleton testID="ReceiptDetail.loading" count={3} />
        )}
      </Screen>
    );
  }

  const share = async (): Promise<void> => {
    const outcome = await shareContent({ title: t.shareSubject(receipt.number), message: receiptShareText(receipt) });
    if (outcome === "unavailable") showToast({ kind: "error", message: t.shareFailed, id: "receipt.share" });
  };
  const copy = async (): Promise<void> => {
    const ok = await copyToClipboard(receipt.number);
    showToast({ kind: ok ? "success" : "error", message: ok ? t.copied : t.shareFailed, id: "receipt.copy" });
  };

  return (
    <Screen testID="ReceiptDetail" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <StaleNote offline={query.isOffline} failedToRefresh={query.isError} onRetry={() => void query.refetch()} testID="ReceiptDetail.stale" />
      <Banner testID="ReceiptDetail.notFiscal" kind="info" title={t.nonFiscalTitle} message={t.nonFiscalMessage} />
      <DetailCard testID="ReceiptDetail.header.card">
        <DetailRow label={t.numberLabel} value={receipt.number} strong />
        <DetailRow label={t.typeLabel} value={receiptKindLabel(receipt.kind)} />
        <DetailRow label={t.issuedLabel} value={formatDateTime(receipt.issuedAt)} />
      </DetailCard>
      {receipt.trip !== null ? (
        <DetailCard testID="ReceiptDetail.trip">
          <Text variant="titleSm" color="heading" size={18}>{t.tripSection}</Text>
          {receipt.counterpart !== null ? <Text variant="body" color="deep" size={16.5}>{withPerson(receipt.counterpart)}</Text> : null}
          <Text variant="body" color="body" size={16}>{tripRouteText(receipt.trip)}</Text>
          {receipt.trip.departureAt !== null ? <Text variant="body" color="muted" size={15}>{formatDateTime(receipt.trip.departureAt)}</Text> : null}
        </DetailCard>
      ) : null}
      <DetailCard testID="ReceiptDetail.breakdown">
        <Text variant="titleSm" color="heading" size={18}>{t.breakdownSection}</Text>
        {receipt.lines.map((line) => <DetailRow key={line.key} label={receiptLineLabel(line.key)} value={receiptTotalText(line.amount)} />)}
        <Divider />
        <DetailRow label={receiptTotalLabel(receipt.kind)} value={receiptTotalText(receipt.total)} strong />
      </DetailCard>
      <Text variant="body" color="muted" size={14.5} style={styles.notice} testID="ReceiptDetail.notice">{receipt.notice}</Text>
      <View style={styles.actions}>
        <Button testID="ReceiptDetail.share" label={t.share} onPress={() => void share()} chevron={false} />
        <Button testID="ReceiptDetail.copy" label={t.copyNumber} variant="outline" chevron={false} onPress={() => void copy()} />
        <Button testID="ReceiptDetail.openPrintable" label={t.printable} variant="outline" chevron={false} onPress={() => setPrintOpen(true)} />
      </View>
      <PrintableSheet
        visible={printOpen}
        html={printable.data ?? null}
        loading={printable.isLoading}
        error={printable.error}
        subject={t.shareSubject(receipt.number)}
        onRetry={() => void printable.refetch()}
        onClose={() => setPrintOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { marginTop: 12 },
  actions: { marginTop: 20, gap: 12, paddingBottom: 12 },
});
