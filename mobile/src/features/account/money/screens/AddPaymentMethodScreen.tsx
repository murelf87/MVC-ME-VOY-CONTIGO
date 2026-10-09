/**
 * Añadir método de pago. NUNCA se pide ni se guarda un número de tarjeta: en producción el método se añade desde la
 * pantalla segura del proveedor de pagos (SDK nativo), que devuelve un token. Mientras el proveedor no esté activo, la
 * pantalla dice «Bloqueado: proveedor de pago pendiente» y no se puede guardar nada. En la vista previa existe un
 * proveedor SIMULADO (marcado como tal) para poder probar el flujo completo sin cobrar nada.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { PaymentMethodPurpose } from "@/api/types/money";
import { IS_PREVIEW_BUILD } from "@/platform";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { useIsOnline } from "@/hooks";
import { Banner, Button, EmptyState, RadioRow, Screen, ScreenHeader, Segmented, Switch, Text, showToast } from "@/ui";
import { LoadError, RowsSkeleton } from "../components/StateBlocks";
import { describeMoneyError } from "../moneyErrors";
import { useMoneyAccess } from "../hooks/useMoneyAccess";
import { useAddPaymentMethod, usePaymentMethods } from "../hooks/usePaymentMethods";
import { paymentsBlocked } from "../model";
import { moneyStrings } from "../strings";

const t = moneyStrings.addMethod;
type Choice = "visa" | "mastercard" | "sepa";
const TOKENS: Record<Choice, string> = { visa: "tok_sim_visa_4242", mastercard: "tok_sim_mastercard_4444", sepa: "tok_sim_sepa_4589" };

export function AddPaymentMethodScreen({ navigation, route }: AppScreenProps<"AddPaymentMethod">): React.JSX.Element {
  const access = useMoneyAccess();
  const online = useIsOnline();
  const [purpose, setPurpose] = useState<PaymentMethodPurpose>(route.params?.purpose === "payout" && access.isDriver ? "payout" : "charge");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [asDefault, setAsDefault] = useState(true);
  const [attempted, setAttempted] = useState(false);
  const query = usePaymentMethods(null, access.signedIn);
  const add = useAddPaymentMethod();
  const header = <ScreenHeader title={t.title} testID="AddPaymentMethod.header" />;

  if (!access.signedIn) {
    return (
      <Screen testID="AddPaymentMethod" header={header}>
        <EmptyState testID="AddPaymentMethod.guest" variant="plain" icon="card" title={moneyStrings.overview.guest.title} message={moneyStrings.overview.guest.message} actionLabel={moneyStrings.overview.guest.action} onAction={() => requireAccount({ name: "AddPaymentMethod" })} />
      </Screen>
    );
  }
  if (query.data === undefined) {
    return (
      <Screen testID="AddPaymentMethod" header={header}>
        {query.isError || query.isOffline ? <LoadError testID="AddPaymentMethod.error" error={query.error} onRetry={() => void query.refetch()} /> : <RowsSkeleton testID="AddPaymentMethod.loading" count={2} />}
      </Screen>
    );
  }

  const blocked = paymentsBlocked(query.data.availability);
  const options: Array<{ value: Choice; title: string; subtitle: string }> = (purpose === "charge" ? (["visa", "mastercard"] as const) : (["sepa"] as const)).map((value) => ({ value, ...t.options[value] }));

  const save = async (): Promise<void> => {
    setAttempted(true);
    if (choice === null) return;
    try {
      await add.mutateAsync({ purpose, providerToken: TOKENS[choice], setAsDefault: asDefault });
      showToast({ kind: "success", message: `${t.saved}. ${t.savedNothingCharged}`, id: "methods.add" });
      navigation.goBack();
    } catch (error) {
      showToast({ kind: "error", message: describeMoneyError(error, "addMethod").message || t.saveFailed, id: "methods.add" });
    }
  };

  if (blocked || !IS_PREVIEW_BUILD) {
    return (
      <Screen testID="AddPaymentMethod" header={header}>
        <Banner testID="AddPaymentMethod.blocked" kind="warning" title={t.blockedTitle} message={t.blockedMessage} />
        <Text variant="titleSm" color="heading" size={19} style={styles.next}>{t.blockedNextTitle}</Text>
        {t.blockedNext.map((line) => <Text key={line} variant="body" color="body" size={16} style={styles.line}>{`• ${line}`}</Text>)}
        <Button testID="AddPaymentMethod.understood" label={t.understood} chevron={false} onPress={() => navigation.goBack()} style={styles.cta} />
      </Screen>
    );
  }

  return (
    <Screen testID="AddPaymentMethod" header={header}>
      <Banner testID="AddPaymentMethod.simulation" kind="info" title={t.simulationTitle} message={t.simulationMessage} />
      {access.isDriver ? (
        <View style={styles.block}>
          <Text variant="titleSm" color="heading" size={18}>{t.purposeLabel}</Text>
          <Segmented testID="AddPaymentMethod.purpose" value={purpose} onChange={(value: PaymentMethodPurpose) => { setPurpose(value); setChoice(null); }} options={[{ value: "charge", label: t.purposeCharge }, { value: "payout", label: t.purposePayout }]} style={styles.gap} />
        </View>
      ) : null}
      <View style={styles.block}>
        <Text variant="titleSm" color="heading" size={18}>{t.chooseTitle}</Text>
        {options.map((option) => (
          <RadioRow key={option.value} testID={`AddPaymentMethod.option.${option.value}`} label={`${option.title} · ${option.subtitle}`} selected={choice === option.value} onSelect={() => setChoice(option.value)} />
        ))}
        {attempted && choice === null ? <Text variant="body" color="error" size={15} testID="AddPaymentMethod.chooseError">{t.chooseError}</Text> : null}
      </View>
      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <Text variant="body" color="deep" size={16.5}>{t.makeDefault}</Text>
          <Text variant="body" color="muted" size={14}>{t.makeDefaultHint}</Text>
        </View>
        <Switch testID="AddPaymentMethod.default" value={asDefault} onValueChange={setAsDefault} accessibilityLabel={t.makeDefault} />
      </View>
      {!online ? <Banner testID="AddPaymentMethod.offline" kind="warning" title={t.offlineTitle} message={t.offlineMessage} style={styles.gap} /> : null}
      <Button testID="AddPaymentMethod.save" label={add.isPending ? t.saving : t.save} chevron={false} loading={add.isPending} disabled={!online} onPress={() => void save()} style={styles.cta} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginTop: 10 },
  block: { marginTop: 18, gap: 6 },
  next: { marginTop: 20 },
  line: { marginTop: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18 },
  cta: { marginTop: 24 },
});
