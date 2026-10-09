/**
 * Métodos de pago. «Para pagar tus viajes» y (si eres conductor) «Para cobrar tus viajes»: solo referencias tokenizadas
 * (nunca un número de tarjeta). Cada método tiene su ⋮ para quitarlo con confirmación; «Añadir método de pago» lleva al alta.
 * Con el proveedor de pagos sin activar se dice claro («Pagos aún no disponibles»): no se cobra ni se guarda nada.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { PaymentMethod, PaymentMethodPurpose } from "@/api/types/money";
import { Icon } from "@/icons";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, ConfirmDialog, EmptyState, OptionSheet, Screen, ScreenHeader, Text, showToast } from "@/ui";
import { MethodCard } from "../components/MethodCard";
import { LoadError, RowsSkeleton, StaleNote } from "../components/StateBlocks";
import { SectionTitle } from "../components/SectionTitle";
import { describeMoneyError } from "../moneyErrors";
import { useMoneyAccess } from "../hooks/useMoneyAccess";
import { usePaymentMethods, useRemovePaymentMethod } from "../hooks/usePaymentMethods";
import { methodStatusChip, paymentsBlocked, sortMethods } from "../model";
import { moneyStrings } from "../strings";

const t = moneyStrings.methods;

function Section({ purpose, items, onMenu }: { purpose: PaymentMethodPurpose; items: PaymentMethod[]; onMenu: (method: PaymentMethod) => void }): React.JSX.Element | null {
  return (
    <View testID={`PaymentMethods.${purpose}`}>
      {sortMethods(items).map((method) => {
        const chip = methodStatusChip(method.status);
        return (
          <View key={method.id} style={styles.item}>
            <View style={styles.flex}>
              <MethodCard method={method} emptyTitle="" emptyMessage="" density="compact" onPress={() => onMenu(method)} accessibilityHint={t.optionsFor(method.title)} testID={`PaymentMethods.method.${method.id}`} />
            </View>
            {method.isDefault ? <Text variant="rowTextStrong" color="link" size={13}>{t.defaultTag}</Text> : null}
            {chip !== null ? <Text variant="rowTextStrong" color="warning" size={13}>{chip.label}</Text> : null}
            <Pressable testID={`PaymentMethods.menu.${method.id}`} accessibilityRole="button" accessibilityLabel={t.optionsFor(method.title)} hitSlop={10} onPress={() => onMenu(method)} style={styles.dots}>
              <Icon name="more" size={26} color={colors.primary} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export function PaymentMethodsScreen({ navigation }: AppScreenProps<"PaymentMethods">): React.JSX.Element {
  const access = useMoneyAccess();
  const query = usePaymentMethods(null, access.signedIn);
  const remove = useRemovePaymentMethod();
  const [menu, setMenu] = useState<PaymentMethod | null>(null);
  const [confirm, setConfirm] = useState<PaymentMethod | null>(null);
  const header = <ScreenHeader title={t.title} testID="PaymentMethods.header" />;

  if (!access.signedIn) {
    return (
      <Screen testID="PaymentMethods" header={header}>
        <EmptyState testID="PaymentMethods.guest" variant="plain" icon="card" title={moneyStrings.overview.guest.title} message={moneyStrings.overview.guest.message} actionLabel={moneyStrings.overview.guest.action} onAction={() => requireAccount({ name: "PaymentMethods" })} />
      </Screen>
    );
  }
  const data = query.data;
  if (data === undefined) {
    return (
      <Screen testID="PaymentMethods" header={header}>
        {query.isError || query.isOffline ? <LoadError testID="PaymentMethods.error" error={query.error} heading={t.loadError} onRetry={() => void query.refetch()} /> : <RowsSkeleton testID="PaymentMethods.loading" count={2} />}
      </Screen>
    );
  }

  const blocked = paymentsBlocked(data.availability);
  const charge = data.items.filter((m) => m.purpose === "charge");
  const payout = data.items.filter((m) => m.purpose === "payout");

  const doRemove = async (): Promise<void> => {
    if (confirm === null) return;
    try {
      await remove.mutateAsync(confirm.id);
      showToast({ kind: "success", message: t.removed, id: "methods.remove" });
    } catch (error) {
      showToast({ kind: "error", message: describeMoneyError(error, "removeMethod").message || t.removeFailed, id: "methods.remove" });
    } finally {
      setConfirm(null);
    }
  };

  return (
    <Screen testID="PaymentMethods" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <StaleNote offline={query.isOffline} failedToRefresh={query.isError} onRetry={() => void query.refetch()} testID="PaymentMethods.stale" />
      {blocked ? <Banner testID="PaymentMethods.blocked" kind="warning" title={t.availabilityTitle} message={t.availabilityMessage} /> : null}

      <SectionTitle title={t.chargeSection} style={styles.section} />
      {charge.length > 0 ? <Section purpose="charge" items={charge} onMenu={setMenu} /> : <MethodCard method={null} emptyTitle={t.emptyCharge.title} emptyMessage={blocked ? t.emptyCharge.disabled : t.emptyCharge.enabled} onPress={() => navigation.navigate("AddPaymentMethod", { purpose: "charge" })} testID="PaymentMethods.emptyCharge" />}
      <Button testID="PaymentMethods.addCharge" label={t.add} variant="outline" chevron={false} onPress={() => navigation.navigate("AddPaymentMethod", { purpose: "charge" })} style={styles.add} />

      {access.isDriver ? (
        <>
          <SectionTitle title={t.payoutSection} style={styles.section} />
          {payout.length > 0 ? <Section purpose="payout" items={payout} onMenu={setMenu} /> : <MethodCard method={null} emptyTitle={t.emptyPayout.title} emptyMessage={blocked ? t.emptyPayout.disabled : t.emptyPayout.enabled} onPress={() => navigation.navigate("AddPaymentMethod", { purpose: "payout" })} testID="PaymentMethods.emptyPayout" />}
          <Button testID="PaymentMethods.addPayout" label={t.add} variant="outline" chevron={false} onPress={() => navigation.navigate("AddPaymentMethod", { purpose: "payout" })} style={styles.add} />
        </>
      ) : null}

      <Text variant="body" color="muted" size={14.5} style={styles.privacy} testID="PaymentMethods.privacy">{t.privacy}</Text>

      <OptionSheet
        testID="PaymentMethods.menuSheet"
        visible={menu !== null}
        title={menu !== null ? t.optionsFor(menu.title) : undefined}
        options={[{ value: "remove", label: t.optionRemove, description: t.optionRemoveHint, destructive: true }]}
        onSelect={() => {
          setConfirm(menu);
          setMenu(null);
        }}
        onClose={() => setMenu(null)}
      />
      <ConfirmDialog
        testID="PaymentMethods.removeDialog"
        visible={confirm !== null}
        destructive
        loading={remove.isPending}
        title={t.removeTitle}
        message={confirm !== null ? t.removeMessage(confirm.title) : ""}
        confirmLabel={t.removeConfirm}
        cancelLabel="Cancelar"
        onConfirm={() => void doRemove()}
        onCancel={() => (remove.isPending ? undefined : setConfirm(null))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginTop: 20 },
  item: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  dots: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  add: { marginTop: 12 },
  privacy: { marginTop: 20 },
});
