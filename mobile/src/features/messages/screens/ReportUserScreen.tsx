/**
 * Denunciar (sin lámina; se diseña con la 28 y la 35 al lado). Una persona o un mensaje concreto: motivo (obligatorio),
 * descripción (obligatoria si es «Otro motivo»), mensajes como prueba (hasta 10, solo al denunciar a la persona) y envío
 * con `Idempotency-Key`. Tras enviar: confirmación con referencia y, si procede, ofrecer bloquear. Es confidencial.
 * Estados: cargando contexto · formulario · enviando · error · enviada.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { ChatMessage, UserReportReason } from "@/api/types";
import { useApiQuery } from "@/hooks";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Banner, Button, Checkbox, ConfirmDialog, Radio, Screen, ScreenHeader, Skeleton, Text, TextArea, showToast } from "@/ui";
import { getConversation } from "../api";
import { useBlockActions } from "../hooks/useBlockActions";
import { conversationKey } from "../hooks/keys";
import { useReportMessage, useReportPerson, useReportableMessages } from "../hooks/useReport";
import { messagesStrings } from "../strings";

const copy = messagesStrings.report;
const SIDE = 14;
const MAX_EVIDENCE = 10;
const MIN_OTHER = 10;
const MAX_DETAILS = 1000;
const REASONS = ["harassment", "unsafe_behavior", "inappropriate_content", "spam_or_fraud", "no_show", "other"] as const satisfies readonly UserReportReason[];

export function ReportUserScreen({ navigation, route }: AppScreenProps<"ReportUser">): React.JSX.Element {
  const { userId, conversationId, messageId } = route.params;
  const isMessage = messageId !== undefined && conversationId !== undefined;

  const conversation = useApiQuery(conversationKey(conversationId ?? "none"), ({ signal }) => getConversation(conversationId ?? "", { signal }), { enabled: conversationId !== undefined, staleTimeMs: 20_000 });
  const messages = useReportableMessages(conversationId);
  const reportPerson = useReportPerson();
  const reportMessage = useReportMessage(conversationId ?? "", messageId ?? "");
  const blocks = useBlockActions();

  const [reason, setReason] = React.useState<UserReportReason | null>(null);
  const [details, setDetails] = React.useState("");
  const [evidence, setEvidence] = React.useState<string[]>([]);
  const [triedSend, setTriedSend] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [sentRef, setSentRef] = React.useState<string | null>(null);
  const [blockedNow, setBlockedNow] = React.useState(false);

  const detail = conversation.data;
  const reported = detail === undefined ? undefined : detail.peer !== null && detail.peer.id === userId ? detail.peer : detail.members?.find((m) => m.user.id === userId)?.user;
  const name = reported?.firstName ?? null;
  const theirMessages: ChatMessage[] = (messages.data ?? []).filter((m) => m.senderId === userId && !m.hidden && m.body !== null);
  const quoted = isMessage ? (messages.data ?? []).find((m) => m.id === messageId) : undefined;
  const pending = reportPerson.isPending || reportMessage.isPending;
  const dirty = reason !== null || details.trim() !== "" || evidence.length > 0;

  const trimmed = details.trim();
  const reasonError = triedSend && reason === null ? copy.reasonRequired : undefined;
  const detailsError = triedSend && reason === "other" && trimmed.length < MIN_OTHER ? copy.detailsRequired : trimmed.length > MAX_DETAILS ? copy.detailsTooLong : undefined;

  const toggleEvidence = (id: string, on: boolean): void => {
    if (on && evidence.length >= MAX_EVIDENCE) {
      showToast({ kind: "info", message: copy.evidenceLimit });
      return;
    }
    setEvidence((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
  };

  const submit = async (): Promise<void> => {
    setTriedSend(true);
    if (reason === null || (reason === "other" && trimmed.length < MIN_OTHER) || trimmed.length > MAX_DETAILS) return;
    const base = { reason, ...(trimmed !== "" ? { details: trimmed } : {}) };
    const result = isMessage
      ? await reportMessage.mutate(base)
      : await reportPerson.mutate({ reportedUserId: userId, ...base, ...(conversationId !== undefined ? { conversationId } : {}), ...(evidence.length > 0 && conversationId !== undefined ? { evidenceMessageIds: evidence } : {}) });
    if (result) setSentRef(result.id);
  };

  const block = async (): Promise<void> => {
    try {
      await blocks.block.mutateAsync(userId);
      setBlockedNow(true);
      showToast({ kind: "success", message: copy.sentBlocked(name ?? "la persona") });
    } catch (error) {
      showToast({ kind: "error", message: describeError(error).message });
    }
  };

  const leave = (): void => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Inbox");
  };

  const title = isMessage ? copy.titleMessage : copy.title;
  const header = <ScreenHeader title={title} testID="ReportUser.header" onBack={dirty && sentRef === null ? () => setDiscardOpen(true) : undefined} />;

  if (sentRef !== null) {
    return (
      <Screen testID="ReportUser" paddingX={SIDE} header={<ScreenHeader title={isMessage ? copy.messageTitle : copy.reportedTitle} testID="ReportUser.header" hideBack />}>
        <View style={styles.sentBlock} testID="ReportUser.sent">
          <Banner kind="success" title={copy.sentTitle} message={copy.sentMessage} testID="ReportUser.sentBanner" />
          <Text variant="body" color="muted" size={15} style={styles.sentRef} testID="ReportUser.reference" selectable>{copy.sentReference(sentRef)}</Text>
          {name !== null && !blockedNow ? (
            <>
              <Text variant="body" color="body" size={16} lineHeight={22} style={styles.gap}>{copy.sentBlockSuggestion(name)}</Text>
              <Button testID="ReportUser.block" label={copy.sentBlock(name)} variant="outline" chevron={false} loading={blocks.block.isPending} onPress={() => void block()} style={styles.gap} />
            </>
          ) : null}
          <Button testID="ReportUser.done" label={conversationId !== undefined ? copy.backToChat : copy.sentDone} onPress={leave} style={styles.gap} />
        </View>
      </Screen>
    );
  }

  const submitError = reportMessage.error ?? reportPerson.error;
  const loadingContext = conversationId !== undefined && conversation.isLoading && detail === undefined;

  return (
    <Screen testID="ReportUser" paddingX={SIDE} header={header}>
      <View style={styles.block}>
        {loadingContext ? (
          <View testID="ReportUser.loading" accessible accessibilityLabel={messagesStrings.common.updating} accessibilityState={{ busy: true }}>
            <Skeleton height={60} radius={16} />
          </View>
        ) : (
          <>
            {name !== null ? <Text variant="titleSm" color="heading" size={19} testID="ReportUser.who">{isMessage ? copy.messageTitle : copy.reportedTitle}: {name}</Text> : null}
            {isMessage ? (
              messages.isLoading ? (
                <Text variant="body" color="muted" size={15} style={styles.gap}>{copy.messageLoading}</Text>
              ) : quoted?.body ? (
                <View style={styles.quote} testID="ReportUser.quote"><Text variant="body" color="strong" size={16} lineHeight={22}>{copy.quote(quoted.body)}</Text></View>
              ) : (
                <Banner testID="ReportUser.messageGone" kind="warning" size="sm" title={copy.messageGone} style={styles.gap} />
              )
            ) : null}

            <Text variant="titleSm" color="heading" size={19} style={styles.section} accessibilityRole="header">{copy.reasonTitle}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={copy.reasonA11y} style={styles.gap}>
              {REASONS.map((value) => {
                const selected = reason === value;
                return (
                  <Pressable
                    key={value}
                    testID={`ReportUser.reason.${value}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: pending }}
                    accessibilityLabel={`${copy.reasons[value].label}. ${copy.reasons[value].description}`}
                    disabled={pending}
                    onPress={() => setReason(value)}
                    style={[styles.reasonRow, selected ? styles.reasonSelected : null]}
                  >
                    <Radio selected={selected} look="strong" />
                    <View style={styles.flex}>
                      <Text variant="rowTitle" color={selected ? "heading" : "body"} size={17}>{copy.reasons[value].label}</Text>
                      <Text variant="body" color="muted" size={14.5} lineHeight={19}>{copy.reasons[value].description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {reasonError ? <Text variant="body" color="error" size={14.5} style={styles.error} testID="ReportUser.reasonError">{reasonError}</Text> : null}

            <Text variant="titleSm" color="heading" size={19} style={styles.section}>{copy.detailsLabel}{reason === "other" ? "" : copy.detailsOptional}</Text>
            <View style={styles.gap}>
              <TextArea testID="ReportUser.details" value={details} onChangeText={setDetails} placeholder={copy.detailsPlaceholder} maxLength={MAX_DETAILS} minHeight={96} error={detailsError} disabled={pending} accessibilityLabel={copy.detailsLabel} />
            </View>

            {!isMessage && conversationId !== undefined ? (
              <View testID="ReportUser.evidence">
                <Text variant="titleSm" color="heading" size={19} style={styles.section}>{copy.evidenceTitle} <Text variant="body" color="muted" size={15}>{copy.evidenceOptional}</Text></Text>
                <Text variant="body" color="muted" size={14.5} lineHeight={19} style={styles.hint}>{copy.evidenceHint}</Text>
                {messages.isLoading ? (
                  <Skeleton height={48} radius={12} style={styles.gap} />
                ) : messages.error && messages.data === undefined ? (
                  <Banner testID="ReportUser.evidenceError" kind="warning" size="sm" title={copy.evidenceLoadError} style={styles.gap} />
                ) : theirMessages.length === 0 ? (
                  <Text variant="body" color="muted" size={15} style={styles.gap} testID="ReportUser.evidenceEmpty">{copy.evidenceEmpty}</Text>
                ) : (
                  <>
                    {theirMessages.slice(-30).map((m) => (
                      <Checkbox key={m.id} testID={`ReportUser.evidence.${m.id}`} checked={evidence.includes(m.id)} onChange={(on) => toggleEvidence(m.id, on)} label={m.body ?? ""} disabled={pending} style={styles.evidenceRow} />
                    ))}
                    <Text variant="body" color="muted" size={14.5} style={styles.hint} testID="ReportUser.evidenceCount">{copy.evidenceCount(evidence.length)}</Text>
                  </>
                )}
              </View>
            ) : null}

            <Banner testID="ReportUser.privacy" kind="info" size="sm" title={copy.privacy} style={styles.section} />
            {submitError ? <Banner testID="ReportUser.submitError" kind="error" title={copy.notRelatedTitle} message={describeError(submitError).message} style={styles.gap} /> : null}

            <Button testID="ReportUser.submit" label={pending ? copy.submitting : copy.submit} loading={pending} disabled={pending} onPress={() => void submit()} style={styles.section} />
            <Button testID="ReportUser.cancel" label={copy.cancel} variant="outline" chevron={false} disabled={pending} onPress={() => (dirty ? setDiscardOpen(true) : leave())} style={styles.gap} />
          </>
        )}
      </View>
      <ConfirmDialog visible={discardOpen} destructive title={copy.discardTitle} message={copy.discardMessage} confirmLabel={copy.discardYes} cancelLabel={copy.discardNo} onConfirm={() => { setDiscardOpen(false); leave(); }} onCancel={() => setDiscardOpen(false)} testID="ReportUser.discardDialog" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { paddingTop: 8, paddingBottom: 28 },
  sentBlock: { paddingTop: 12, paddingBottom: 28 },
  sentRef: { marginTop: 10 },
  gap: { marginTop: 10 },
  hint: { marginTop: 4 },
  section: { marginTop: 22 },
  error: { marginTop: 6 },
  quote: { marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: colors.bg.tint, borderLeftWidth: 4, borderLeftColor: colors.primary },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.bg.tint, marginTop: 8 },
  reasonSelected: { backgroundColor: colors.bg.tintStrong },
  evidenceRow: { marginTop: 10 },
});
