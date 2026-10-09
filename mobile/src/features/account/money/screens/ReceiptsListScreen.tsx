/**
 * Facturas y justificantes. Lista paginada con filtro por tipo (todos · pagos · devoluciones · abonos). Cada fila abre el
 * recibo. Son justificantes NO fiscales y así se dice arriba. Estados: cargando · error · sin conexión · vacío (con y sin filtro).
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ReceiptKind } from "@/api/types/money";
import { Icon } from "@/icons";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, EmptyState, Screen, ScreenHeader, Text } from "@/ui";
import { FilterPills, ListFooter, type FilterOption } from "../components/ListBits";
import { LoadError, RowsSkeleton, StaleNote } from "../components/StateBlocks";
import { useMoneyAccess } from "../hooks/useMoneyAccess";
import { useReceiptsList } from "../hooks/useReceipts";
import { receiptKindIcon, receiptKindLabel, receiptRowSubtitle, receiptTotalText, tripRouteText } from "../model";
import { moneyStrings } from "../strings";

const t = moneyStrings.receipts;
const FILTERS: FilterOption<ReceiptKind>[] = [
  { value: null, label: t.filterAll },
  { value: "payment", label: t.filterPayment },
  { value: "refund", label: t.filterRefund },
  { value: "earning_statement", label: t.filterEarning },
];

export function ReceiptsListScreen({ navigation, route }: AppScreenProps<"ReceiptsList">): React.JSX.Element {
  const access = useMoneyAccess();
  const [kind, setKind] = useState<ReceiptKind | null>(null);
  const list = useReceiptsList(kind);
  const header = <ScreenHeader title={t.title} testID="ReceiptsList.header" />;

  if (!access.signedIn) {
    return (
      <Screen testID="ReceiptsList" header={header}>
        <EmptyState testID="ReceiptsList.guest" variant="plain" icon="card" title={moneyStrings.overview.guest.title} message={moneyStrings.overview.guest.message} actionLabel={moneyStrings.overview.guest.action} onAction={() => requireAccount({ name: "ReceiptsList", params: route.params })} />
      </Screen>
    );
  }

  const filtered = kind !== null;
  return (
    <Screen testID="ReceiptsList" header={header} refreshing={list.isRefreshing} onRefresh={() => void list.refresh()}>
      <Banner testID="ReceiptsList.notFiscal" kind="info" title={t.notFiscalTitle} message={t.notFiscalMessage} />
      <View style={styles.gap} />
      <FilterPills testID="ReceiptsList.filter" a11yLabel={t.title} options={FILTERS} value={kind} onChange={setKind} />
      <StaleNote offline={list.isOffline} failedToRefresh={list.isError && list.items.length > 0} onRetry={() => void list.refresh()} testID="ReceiptsList.stale" />
      {list.isLoading && list.items.length === 0 ? <RowsSkeleton testID="ReceiptsList.skeleton" /> : null}
      {list.items.length === 0 && (list.isError || list.isOffline) ? <LoadError testID="ReceiptsList.error" error={list.error} heading={t.loadError} onRetry={() => void list.refresh()} /> : null}
      {list.isEmpty ? (
        <EmptyState
          testID="ReceiptsList.empty"
          icon="card"
          title={filtered ? t.emptyFiltered.title : t.empty.title}
          message={filtered ? t.emptyFiltered.message : t.empty.message}
          actionLabel={filtered ? t.emptyFiltered.action : undefined}
          onAction={filtered ? () => setKind(null) : undefined}
          variant="plain"
        />
      ) : null}
      {list.items.map((receipt) => {
        const route = receipt.trip !== null ? tripRouteText(receipt.trip) : "";
        return (
          <Pressable
            key={receipt.id}
            testID={`ReceiptsList.row.${receipt.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${receiptKindLabel(receipt.kind)}. ${receiptRowSubtitle(receipt.number, receipt.issuedAt)}. ${receiptTotalText(receipt.total)}`}
            onPress={() => navigation.navigate("ReceiptDetail", { receiptId: receipt.id })}
            style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
          >
            <Icon name={receiptKindIcon(receipt.kind)} size={24} color={colors.primary} />
            <View style={styles.flex}>
              <Text variant="titleSm" color="heading" size={17.5}>{receiptKindLabel(receipt.kind)}</Text>
              <Text variant="body" color="muted" size={14.5}>{receiptRowSubtitle(receipt.number, receipt.issuedAt)}</Text>
              {route !== "" ? <Text variant="body" color="body" size={15} numberOfLines={1}>{route}</Text> : null}
            </View>
            <Text variant="titleSm" color="heading" size={17.5}>{receiptTotalText(receipt.total)}</Text>
          </Pressable>
        );
      })}
      <ListFooter testID="ReceiptsList.more" hasMore={list.hasMore} loading={list.isFetchingMore} error={list.fetchMoreError !== null} errorText={t.loadMoreError} moreLabel={moneyStrings.seeAll} onMore={() => void list.fetchMore()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { height: 12 },
  pressed: { opacity: 0.7 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginTop: 8, minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF" },
});
