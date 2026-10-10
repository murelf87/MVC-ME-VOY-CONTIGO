import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { LegalDocumentSummary } from "@/api/types";
import { formatDateTime } from "@/i18n";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, BottomSheet, Button, EmptyState, Screen, StatusPill, Text, TextField, showToast, type StatusTone } from "@/ui";
import { AdminHeader } from "../../review/components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../../review/components/AccessStates";
import { CardListSkeleton, RefreshFailedStrip } from "../../review/components/ListStates";
import { StaffAccessSheet } from "../../review/components/StaffAccessSheet";
import { useAdminGate } from "../../review/hooks/useAdminGate";
import { adminError } from "../../review/logic/errors";
import { staffInitial } from "../../review/logic/permissions";
import { backofficeStrings } from "../backofficeStrings";
import { useLegalDocuments, useLegalVersionText, usePublishLegalDocument } from "../hooks/useLegal";
import { canPublish, groupByKind, validatePublish, type PublishErrors } from "../model/legal";

const s = backofficeStrings.legal;
const TONE: Record<LegalDocumentSummary["status"], StatusTone> = { draft_pending_legal_review: "amber", published: "green", retired: "gray" };

function DocumentText({ doc }: { doc: LegalDocumentSummary }): React.JSX.Element {
  const text = useLegalVersionText(doc.kind, doc.version, true);
  if (text.data === undefined) {
    return text.isError ? (
      <View style={styles.textBox}>
        <Text variant="body" color="error" size={15}>{s.textError}</Text>
        <Button label={backofficeStrings.common.retry} variant="outline" size="sm" inline chevron={false} onPress={() => void text.refetch()} testID={`AdminLegalDocs.doc.${doc.id}.textRetry`} />
      </View>
    ) : (
      <Text variant="body" color="muted" size={15} style={styles.textBox}>{s.loadingText}</Text>
    );
  }
  return (
    <View style={styles.textBox} testID={`AdminLegalDocs.doc.${doc.id}.text`}>
      {text.data.sections.map((section, index) => (
        <View key={`${index}-${section.heading}`} style={index > 0 ? styles.section : null}>
          <Text variant="titleSm" color="heading" size={16.5}>{section.heading}</Text>
          {section.paragraphs.map((paragraph, i) => (
            <Text key={`p${i}`} variant="body" color="body" size={15} style={styles.paragraph}>{paragraph}</Text>
          ))}
          {section.bullets.map((bullet, i) => (
            <Text key={`b${i}`} variant="body" color="body" size={15} style={styles.bullet}>{`•  ${bullet}`}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function DocumentCard({
  doc,
  canWrite,
  onPublish,
  onCopy,
}: {
  doc: LegalDocumentSummary;
  canWrite: boolean;
  onPublish: (doc: LegalDocumentSummary) => void;
  onCopy: (doc: LegalDocumentSummary) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.card} testID={`AdminLegalDocs.doc.${doc.id}`}>
      <View style={styles.head}>
        <Text variant="titleSm" color="heading" size={18} style={styles.flex}>{s.version(doc.version)}</Text>
        <StatusPill label={s.statusShort[doc.status] ?? doc.status} tone={TONE[doc.status]} size="sm" />
      </View>
      <Text variant="body" color="body" size={15.5}>{doc.title}</Text>
      {doc.pendingLegalReview ? <Text variant="body" color="warning" size={15} testID={`AdminLegalDocs.doc.${doc.id}.reviewNote`}>{`${s.status.draft_pending_legal_review}. ${s.noEffect}`}</Text> : null}
      {doc.publishedAt !== null ? <Text variant="body" color="success" size={15}>{s.published(formatDateTime(doc.publishedAt))}</Text> : null}
      {doc.effectiveFrom !== null && doc.status === "published" ? <Text variant="caption" color="subtle" size={13.5}>{s.effectiveFrom(formatDateTime(doc.effectiveFrom))}</Text> : null}
      {doc.status === "retired" ? <Text variant="caption" color="subtle" size={13.5}>{s.status.retired}</Text> : null}
      <View style={styles.actions}>
        <Button
          testID={`AdminLegalDocs.doc.${doc.id}.toggle`}
          label={open ? s.hideText : s.view}
          variant="outline"
          size="sm"
          inline
          chevron={false}
          onPress={() => setOpen((value) => !value)}
        />
        {canWrite && canPublish(doc.status) ? <Button testID={`AdminLegalDocs.doc.${doc.id}.publish`} label={s.publish} size="sm" inline chevron={false} onPress={() => onPublish(doc)} /> : null}
        {canWrite ? <Button testID={`AdminLegalDocs.doc.${doc.id}.copy`} label={s.editCopy} variant="outline" size="sm" inline chevron={false} onPress={() => onCopy(doc)} /> : null}
      </View>
      {open ? <DocumentText doc={doc} /> : null}
    </View>
  );
}

/**
 * Documentos legales (sin lámina). Todas las versiones agrupadas por documento. Un borrador no tiene validez legal hasta
 * que Administración lo publica con la referencia de la revisión legal que lo aprueba.
 */
export function AdminLegalDocsScreen({ navigation }: AppScreenProps<"AdminLegalDocs">): React.JSX.Element {
  const gate = useAdminGate((access) => access.canRead("legal"));
  const { access } = gate;
  const ready = gate.state === "ready";
  const canWrite = access.canWrite("legal");
  const list = useLegalDocuments(ready);
  const publish = usePublishLegalDocument();

  const [publishing, setPublishing] = useState<LegalDocumentSummary | null>(null);
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [errors, setErrors] = useState<PublishErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const groups = useMemo(() => groupByKind(list.data?.items ?? []), [list.data]);

  const openPublish = (doc: LegalDocumentSummary): void => {
    setPublishing(doc);
    setReference("");
    setDate("");
    setErrors({});
    setServerError(null);
  };

  const submitPublish = async (): Promise<void> => {
    if (publishing === null) return;
    const result = validatePublish(reference, date, Date.now());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setServerError(null);
    try {
      await publish.mutateAsync({ documentId: publishing.id, request: result.request });
      setPublishing(null);
      showToast({ kind: "success", message: s.publishedToast, id: "legal.publish" });
    } catch (error) {
      setServerError(adminError(error).message);
    }
  };

  const listError = list.isError && list.data === undefined ? adminError(list.error) : null;
  const loading = list.data === undefined && !list.isError;

  let body: React.ReactNode;
  if (gate.state === "checking") body = <CheckingAccess />;
  else if (gate.state === "error" && gate.error !== null) body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminLegalDocs.error" />;
  else if (gate.state === "denied") body = <NoPermission testID="AdminLegalDocs.denied" message={s.deniedMessage} onGoHome={gate.goHome} />;
  else if (listError !== null) body = <PanelError error={listError} onRetry={() => void list.refetch()} onGoHome={gate.goHome} testID="AdminLegalDocs.listError" />;
  else if (loading) body = <CardListSkeleton testID="AdminLegalDocs.loading" />;
  else if (groups.length === 0) {
    body = <EmptyState testID="AdminLegalDocs.empty" icon="document" title={s.emptyTitle} message={s.emptyMessage} actionLabel={canWrite ? s.newVersion : undefined} onAction={canWrite ? () => navigation.navigate("AdminLegalEditor") : undefined} />;
  } else {
    body = (
      <>
        {list.isError ? <RefreshFailedStrip offline={list.isOffline} onRetry={() => void list.refetch()} /> : null}
        {groups.map((group) => (
          <View key={group.kind} style={styles.group} testID={`AdminLegalDocs.group.${group.kind}`}>
            <Text variant="rowTitle" color="heading" size={18} style={styles.groupTitle}>{s.kinds[group.kind] ?? group.kind}</Text>
            {group.items.map((doc) => (
              <View key={doc.id} style={styles.gap}>
                <DocumentCard
                  doc={doc}
                  canWrite={canWrite}
                  onPublish={openPublish}
                  onCopy={(source) => navigation.navigate("AdminLegalEditor", { documentId: source.id })}
                />
              </View>
            ))}
          </View>
        ))}
      </>
    );
  }

  const header = (
    <View>
      <AdminHeader subtitle={s.subtitle} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} testID="AdminLegalDocs.header" />
      {ready ? (
        <View style={styles.controls}>
          <Text variant="body" color="body" size={15.5}>{s.intro}</Text>
          {canWrite ? <Button testID="AdminLegalDocs.new" label={s.newVersion} chevron={false} accessibilityLabel={s.newVersionA11y} onPress={() => navigation.navigate("AdminLegalEditor")} style={styles.newButton} /> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Screen testID="AdminLegalDocs" header={header} paddingX={11} refreshing={list.isRefreshing} onRefresh={ready ? () => void list.refetch() : undefined} contentContainerStyle={styles.list}>
        {body}
      </Screen>

      <BottomSheet
        visible={publishing !== null}
        onClose={() => (publish.isPending ? undefined : setPublishing(null))}
        title={publishing !== null ? s.publishTitle(s.kinds[publishing.kind] ?? publishing.title) : undefined}
        subtitle={s.publishSubtitle}
        testID="AdminLegalDocs.publishSheet"
        footer={
          <View style={styles.sheetActions}>
            <Button testID="AdminLegalDocs.publishSheet.confirm" label={s.publishConfirm} chevron={false} loading={publish.isPending} onPress={() => void submitPublish()} />
            <Button testID="AdminLegalDocs.publishSheet.cancel" label={backofficeStrings.common.cancel} variant="outline" chevron={false} disabled={publish.isPending} onPress={() => setPublishing(null)} />
          </View>
        }
      >
        {serverError !== null ? <Banner kind="error" size="sm" title={backofficeStrings.common.errorTitle} message={serverError} style={styles.gapBottom} testID="AdminLegalDocs.publishSheet.error" /> : null}
        <TextField
          testID="AdminLegalDocs.publishSheet.reference"
          label={s.referenceLabel}
          value={reference}
          onChangeText={setReference}
          placeholder={s.referencePlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          error={errors.reference}
        />
        <TextField
          testID="AdminLegalDocs.publishSheet.date"
          label={s.dateLabel}
          value={date}
          onChangeText={setDate}
          placeholder="dd/mm/aaaa"
          keyboardType="numbers-and-punctuation"
          error={errors.effectiveFrom}
          helper={errors.effectiveFrom === undefined ? s.dateHelper : undefined}
          style={styles.fieldGap}
        />
      </BottomSheet>

      <StaffAccessSheet
        visible={gate.sheetOpen}
        onClose={gate.closeSheet}
        me={access.me}
        loading={access.query.isLoading || access.query.isIdle}
        error={gate.error}
        onRetry={gate.retry}
        onGoHome={gate.goHome}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  controls: { paddingHorizontal: 11, paddingTop: 7 },
  newButton: { marginTop: 12 },
  list: { paddingTop: 12, paddingBottom: 16 },
  group: { marginBottom: 18 },
  groupTitle: { marginBottom: 8, paddingHorizontal: 2 },
  gap: { marginTop: 10 },
  gapBottom: { marginBottom: 12 },
  fieldGap: { marginTop: 12 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  textBox: { marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: colors.bg.tintSoft, gap: 4 },
  section: { marginTop: 12 },
  paragraph: { marginTop: 4 },
  bullet: { marginTop: 3, paddingLeft: 4 },
  sheetActions: { gap: 10 },
});
