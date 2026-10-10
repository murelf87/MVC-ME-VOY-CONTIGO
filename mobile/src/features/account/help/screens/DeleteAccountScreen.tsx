/**
 * Eliminar cuenta (RGPD). Muestra qué se borra, qué se conserva sin identificarte y qué se guarda por obligación legal;
 * los bloqueos que impiden pedirla (con la salida a cada uno); la confirmación escribiendo ELIMINAR y una confirmación
 * final. Tras pedirla hay un plazo de gracia en el que se puede cancelar. Con el proceso ya empezado no se puede cancelar.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError, isApiErrorWithCode, isOfflineError } from "@/api";
import type { AccountDeletionBlocker } from "@/api/types";
import { formatDateShort } from "@/i18n";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Banner, Button, ConfirmDialog, Screen, ScreenHeader, Text, TextField, showToast } from "@/ui";
import { ComposeField } from "../components/ComposeField";
import { ListSkeleton, LoadError } from "../components/StateCards";
import { useAccountDeletion, useCancelDeletion, useRequestDeletion } from "../hooks/useAccountData";
import { helpStrings } from "../strings";

const t = helpStrings.deletion;
const CONFIRM_WORD = "ELIMINAR";
const MAX_REASON = 500;

type Nav = AppScreenProps<"DeleteAccount">["navigation"];

function goToBlocker(navigation: Nav, code: string): void {
  if (code === "ACTIVE_TRIP_AS_DRIVER") navigation.navigate("MyTrips", { role: "driver" });
  else if (code === "PENDING_PAYMENT_COMPENSATION") navigation.navigate("Refunds");
  else navigation.navigate("MyTrips");
}

function List({ title, items, testID }: { title: string; items: string[]; testID: string }): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <View style={styles.planBlock} testID={testID}>
      <Text variant="titleSm" color="heading" size={17}>{title}</Text>
      {items.map((item, index) => <Text key={index} variant="body" color="body" size={15.5}>{`• ${item}`}</Text>)}
    </View>
  );
}

export function DeleteAccountScreen({ navigation }: AppScreenProps<"DeleteAccount">): React.JSX.Element {
  const query = useAccountDeletion(true);
  const requestDeletion = useRequestDeletion();
  const cancelDeletion = useCancelDeletion();
  const [word, setWord] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const header = <ScreenHeader title={t.title} testID="DeleteAccount.header" />;
  const state = query.data;

  if (state === undefined) {
    return (
      <Screen testID="DeleteAccount" header={header}>
        {query.isError || query.isOffline ? <LoadError testID="DeleteAccount.error" title={t.loadErrorTitle} message={t.loadErrorMessage} offline={isOfflineError(query.error) || query.isOffline} onRetry={() => void query.refetch()} /> : <ListSkeleton testID="DeleteAccount.loading" count={3} />}
      </Screen>
    );
  }

  const current = state.request;
  const active = current !== null && (current.status === "scheduled" || current.status === "blocked" || current.status === "processing");
  const wordOk = word.trim() === CONFIRM_WORD;
  const reasonTooLong = reason.length > MAX_REASON;
  const blockers: AccountDeletionBlocker[] = state.blockers;

  const submit = async (): Promise<void> => {
    try {
      const next = await requestDeletion.mutateAsync({ confirmation: CONFIRM_WORD, ...(reason.trim() !== "" ? { reason: reason.trim() } : {}) });
      setConfirm(false);
      setWord("");
      setReason("");
      setTouched(false);
      if (next.request !== null) showToast({ kind: "success", message: t.scheduledToast, id: "deletion.request" });
    } catch (error) {
      setConfirm(false);
      if (isApiErrorWithCode(error, "ACCOUNT_DELETION_BLOCKED")) void query.refetch();
      showToast({ kind: "error", message: describeError(error).message, id: "deletion.request" });
    }
  };

  const cancel = async (): Promise<void> => {
    try {
      await cancelDeletion.mutateAsync();
      showToast({ kind: "success", message: t.cancelledToast, id: "deletion.cancel" });
    } catch (error) {
      showToast({ kind: "error", message: isApiErrorWithCode(error, "ACCOUNT_DELETION_IN_PROGRESS") ? t.inProgressError : describeError(error).message, id: "deletion.cancel" });
      void query.refetch();
    }
  };

  if (active && current !== null) {
    const processing = current.status === "processing";
    const blocked = current.status === "blocked";
    return (
      <Screen testID="DeleteAccount" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
        <Banner
          testID="DeleteAccount.activeBanner"
          kind={processing ? "info" : "warning"}
          title={processing ? t.processingTitle : blocked ? t.blockedRequestTitle : t.scheduledTitle}
          message={processing ? t.processingMessage : blocked ? t.blockedRequestMessage : t.scheduledMessage(formatDateShort(current.scheduledFor))}
        />
        {blocked ? (
          <View style={styles.planBlock} testID="DeleteAccount.blockers">
            {current.blockers.map((b) => (
              <View key={b.code} style={styles.blocker}>
                <Text variant="body" color="body" size={15.5}>{b.message}</Text>
                <Button label={t.blockerAction[b.code] ?? t.blockerFallbackAction} variant="outline" size="sm" chevron={false} onPress={() => goToBlocker(navigation, b.code)} testID={`DeleteAccount.blocker.${b.code}`} style={styles.gapSmall} />
              </View>
            ))}
          </View>
        ) : null}
        {!processing ? <Button testID="DeleteAccount.cancel" label={cancelDeletion.isPending ? t.cancelling : t.cancel} chevron={false} loading={cancelDeletion.isPending} onPress={() => void cancel()} style={styles.gap} /> : null}
      </Screen>
    );
  }

  return (
    <Screen testID="DeleteAccount" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      {current !== null && current.status === "cancelled" ? <Banner testID="DeleteAccount.cancelledBanner" kind="success" title={t.cancelledTitle} message={t.cancelledMessage} style={styles.gapBottom} /> : null}
      <Text variant="body" color="body" size={16.5} lineHeight={22}>{t.intro}</Text>
      <Banner testID="DeleteAccount.grace" kind="info" title={t.graceTitle(state.graceDays)} message={t.graceMessage(state.graceDays)} style={styles.gap} />

      <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.section}>{t.planTitle}</Text>
      <List testID="DeleteAccount.plan.deleted" title={t.planDeleted} items={state.plan.deleted} />
      <List testID="DeleteAccount.plan.anonymised" title={t.planAnonymised} items={state.plan.anonymised} />
      {state.plan.retained.length > 0 ? (
        <View style={styles.planBlock} testID="DeleteAccount.plan.retained">
          <Text variant="titleSm" color="heading" size={17}>{t.planRetained}</Text>
          {state.plan.retained.map((r, index) => (
            <Text key={index} variant="body" color="body" size={15.5}>{`• ${r.item} — ${r.reason}. ${t.retainedFor(r.period)}`}</Text>
          ))}
        </View>
      ) : null}

      {!state.eligible ? (
        <View style={styles.blockBox} testID="DeleteAccount.blockers">
          <Text variant="titleSm" color="heading" size={18}>{t.blockersTitle}</Text>
          <Text variant="body" color="body" size={15.5}>{t.blockersMessage}</Text>
          {blockers.map((b) => (
            <View key={b.code} style={styles.blocker}>
              <Text variant="body" color="deep" size={15.5}>{`${b.message} · ${t.blockersCount(b.count)}`}</Text>
              <Button label={t.blockerAction[b.code] ?? t.blockerFallbackAction} variant="outline" size="sm" chevron={false} onPress={() => goToBlocker(navigation, b.code)} testID={`DeleteAccount.blocker.${b.code}`} style={styles.gapSmall} />
            </View>
          ))}
        </View>
      ) : (
        <>
          <Text variant="heading" color="heading" size={20} lineHeight={25} accessibilityRole="header" style={styles.section}>{t.confirmTitle}</Text>
          <TextField testID="DeleteAccount.confirm" label={t.confirmLabel} value={word} onChangeText={(v) => { setWord(v); setTouched(true); }} placeholder={t.confirmPlaceholder} autoCapitalize="characters" autoCorrect={false} error={touched && !wordOk ? t.confirmError : undefined} helper={t.confirmHelper} />
          <View style={styles.gap} />
          <Text variant="titleSm" color="heading" size={17}>{t.reasonLabel}</Text>
          <ComposeField testID="DeleteAccount.reason" accessibilityLabel={t.reasonLabel} value={reason} onChangeText={setReason} placeholder={t.reasonPlaceholder} maxLength={MAX_REASON + 50} error={reasonTooLong ? t.reasonTooLong : undefined} style={styles.gapSmall} />
          <Button testID="DeleteAccount.submit" label={requestDeletion.isPending ? t.submitting : t.submit} variant="danger" chevron={false} loading={requestDeletion.isPending} disabled={reasonTooLong} onPress={() => { setTouched(true); if (wordOk) setConfirm(true); }} style={styles.gap} />
        </>
      )}

      <ConfirmDialog
        testID="DeleteAccount.dialog"
        visible={confirm}
        destructive
        loading={requestDeletion.isPending}
        title={t.finalConfirmTitle}
        message={t.finalConfirmMessage(formatDateShort(Date.now() + state.graceDays * 86_400_000))}
        confirmLabel={t.finalConfirm}
        cancelLabel={helpStrings.common.cancel}
        onConfirm={() => void submit()}
        onCancel={() => (requestDeletion.isPending ? undefined : setConfirm(false))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 14 },
  gapSmall: { marginTop: 8 },
  gapBottom: { marginBottom: 14 },
  section: { marginTop: 24, marginBottom: 8 },
  planBlock: { marginTop: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 4 },
  blockBox: { marginTop: 20, padding: 14, borderRadius: 14, backgroundColor: colors.amber.bg, gap: 6 },
  blocker: { marginTop: 8 },
});
