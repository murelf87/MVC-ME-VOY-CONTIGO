import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { LegalDocumentKind } from "@/api/types";
import type { AppScreenProps } from "@/navigation";
import { colors } from "@/theme";
import { Banner, Button, ConfirmDialog, OptionSheet, Screen, SelectField, Text, TextArea, TextField, showToast } from "@/ui";
import { AdminHeader } from "../../review/components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../../review/components/AccessStates";
import { StaffAccessSheet } from "../../review/components/StaffAccessSheet";
import { useAdminGate } from "../../review/hooks/useAdminGate";
import { adminError } from "../../review/logic/errors";
import { staffInitial } from "../../review/logic/permissions";
import { backofficeStrings } from "../backofficeStrings";
import { useCreateLegalDocument, useLegalDocuments, useLegalVersionText } from "../hooks/useLegal";
import { LEGAL_KINDS, MAX_SECTIONS, emptySection, sectionsToDrafts, validateLegalDraft, type LegalDraftErrors, type SectionDraft } from "../model/legal";

const s = backofficeStrings.legalEditor;
const kinds = backofficeStrings.legal.kinds;

/**
 * Nueva versión de un documento legal (sin lámina). Se parte de cero o del texto de una versión existente. La versión
 * nace como borrador «pendiente de revisión legal»: guardarla no cambia nada de lo que ven las personas usuarias.
 */
export function AdminLegalEditorScreen({ navigation, route }: AppScreenProps<"AdminLegalEditor">): React.JSX.Element {
  const gate = useAdminGate((access) => access.canWrite("legal"));
  const { access } = gate;
  const ready = gate.state === "ready";
  const baseId = route.params?.documentId;

  const list = useLegalDocuments(ready && baseId !== undefined);
  const base = useMemo(() => list.data?.items.find((doc) => doc.id === baseId) ?? null, [list.data, baseId]);
  const baseText = useLegalVersionText(base?.kind ?? null, base?.version ?? null, ready && base !== null);

  const [kind, setKind] = useState<LegalDocumentKind>("terms");
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<SectionDraft[]>([emptySection()]);
  const [errors, setErrors] = useState<LegalDraftErrors | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const prefilled = useRef(false);
  const create = useCreateLegalDocument();

  // Se rellena una sola vez con el texto base (si lo hay y la persona aún no ha escrito).
  useEffect(() => {
    if (prefilled.current || baseText.data === undefined) return;
    prefilled.current = true;
    setKind(baseText.data.kind);
    setTitle(baseText.data.title);
    setSections(sectionsToDrafts(baseText.data.sections));
  }, [baseText.data]);

  const touch = (): void => setDirty(true);
  const updateSection = (index: number, patch: Partial<SectionDraft>): void => {
    touch();
    setSections((current) => current.map((section, i) => (i === index ? { ...section, ...patch } : section)));
  };
  const move = (index: number, delta: -1 | 1): void => {
    touch();
    setSections((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(target, 0, item);
      return next;
    });
  };

  const exit = (): void => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("AdminLegalDocs");
  };
  const save = async (): Promise<void> => {
    const result = validateLegalDraft(kind, title, sections);
    if (!result.ok) {
      setErrors(result.errors);
      setServerError(null);
      return;
    }
    setErrors(null);
    setServerError(null);
    try {
      await create.mutateAsync(result.input);
      setDirty(false);
      showToast({ kind: "success", message: s.saved, id: "legal.create" });
      exit();
    } catch (error) {
      setServerError(adminError(error).message);
    }
  };

  const leave = (): void => {
    if (dirty) setDiscard(true);
    else exit();
  };

  const baseLoading = baseId !== undefined && !prefilled.current && !baseText.isError && !(list.isError);
  const baseFailed = baseId !== undefined && (baseText.isError || list.isError || (list.data !== undefined && base === null));

  let body: React.ReactNode;
  if (gate.state === "checking") body = <CheckingAccess />;
  else if (gate.state === "error" && gate.error !== null) body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.goHome} testID="AdminLegalEditor.error" />;
  else if (gate.state === "denied") body = <NoPermission testID="AdminLegalEditor.denied" message={backofficeStrings.legal.deniedMessage} onGoHome={gate.goHome} />;
  else {
    body = (
      <View testID="AdminLegalEditor.form">
        <Text variant="body" color="body" size={15.5}>{s.intro}</Text>
        {baseId !== undefined && baseLoading ? <Text variant="body" color="muted" size={15} style={styles.gapTop} testID="AdminLegalEditor.loadingBase">{s.loadingBase}</Text> : null}
        {baseFailed ? <Banner kind="warning" size="sm" message={s.baseError} style={styles.gapTop} testID="AdminLegalEditor.baseError" /> : null}
        {base !== null && baseText.data !== undefined ? <Text variant="caption" color="subtle" size={13.5} style={styles.gapTop}>{s.prefilled(kinds[base.kind] ?? base.title, base.version)}</Text> : null}
        {serverError !== null ? <Banner kind="error" size="sm" title={backofficeStrings.common.errorTitle} message={serverError} style={styles.gapTop} testID="AdminLegalEditor.serverError" /> : null}
        {errors !== null ? <Banner kind="warning" size="sm" message={s.fixErrors} style={styles.gapTop} testID="AdminLegalEditor.fixErrors" /> : null}

        <SelectField
          testID="AdminLegalEditor.kind"
          label={s.kindLabel}
          valueLabel={kinds[kind] ?? kind}
          onPress={() => setKindOpen(true)}
          disabled={baseId !== undefined}
          style={styles.gapTop}
        />
        <TextField
          testID="AdminLegalEditor.title"
          label={s.titleLabel}
          value={title}
          onChangeText={(text) => {
            touch();
            setTitle(text);
          }}
          placeholder={s.titlePlaceholder}
          error={errors?.title}
          style={styles.gapTop}
        />

        <Text variant="rowTitle" color="heading" size={18} style={styles.sectionsTitle}>{s.sectionsHeading}</Text>
        {errors?.sections !== undefined ? <Text variant="body" color="error" size={14.5}>{errors.sections}</Text> : null}
        {sections.map((section, index) => {
          const sectionErrors = errors?.perSection[index];
          return (
            <View key={index} style={styles.sectionCard} testID={`AdminLegalEditor.section.${index}`}>
              <Text variant="titleSm" color="heading" size={16.5}>{s.sectionN(index + 1)}</Text>
              <TextField
                testID={`AdminLegalEditor.section.${index}.heading`}
                label={s.headingLabel}
                value={section.heading}
                onChangeText={(text) => updateSection(index, { heading: text })}
                error={sectionErrors?.heading}
                style={styles.gapTopSm}
              />
              <Text variant="body" color="muted" size={14.5} style={styles.areaLabel}>{s.paragraphsLabel}</Text>
              <TextArea
                testID={`AdminLegalEditor.section.${index}.paragraphs`}
                value={section.paragraphs}
                onChangeText={(text) => updateSection(index, { paragraphs: text })}
                minHeight={96}
                error={sectionErrors?.paragraphs}
                helper={sectionErrors?.paragraphs === undefined ? s.paragraphsHelper : undefined}
                accessibilityLabel={s.paragraphsLabel}
              />
              <Text variant="body" color="muted" size={14.5} style={styles.areaLabel}>{s.bulletsLabel}</Text>
              <TextArea
                testID={`AdminLegalEditor.section.${index}.bullets`}
                value={section.bullets}
                onChangeText={(text) => updateSection(index, { bullets: text })}
                minHeight={72}
                error={sectionErrors?.bullets}
                helper={sectionErrors?.bullets === undefined ? s.bulletsHelper : undefined}
                accessibilityLabel={s.bulletsLabel}
              />
              {sectionErrors?.general !== undefined ? <Text variant="body" color="error" size={14.5} style={styles.gapTopSm}>{sectionErrors.general}</Text> : null}
              <View style={styles.sectionActions}>
                <Button testID={`AdminLegalEditor.section.${index}.up`} label={s.moveUp} variant="outline" size="sm" inline chevron={false} disabled={index === 0} onPress={() => move(index, -1)} />
                <Button testID={`AdminLegalEditor.section.${index}.down`} label={s.moveDown} variant="outline" size="sm" inline chevron={false} disabled={index === sections.length - 1} onPress={() => move(index, 1)} />
                <Button
                  testID={`AdminLegalEditor.section.${index}.remove`}
                  label={s.removeSection}
                  variant="outline"
                  size="sm"
                  inline
                  chevron={false}
                  disabled={sections.length <= 1}
                  onPress={() => {
                    touch();
                    setSections((current) => current.filter((_, i) => i !== index));
                  }}
                />
              </View>
            </View>
          );
        })}
        <Button
          testID="AdminLegalEditor.addSection"
          label={s.addSection}
          variant="outline"
          chevron={false}
          disabled={sections.length >= MAX_SECTIONS}
          onPress={() => {
            touch();
            setSections((current) => [...current, emptySection()]);
          }}
          style={styles.gapTop}
        />
        <View style={styles.actions}>
          <Button testID="AdminLegalEditor.save" label={s.save} chevron={false} loading={create.isPending} onPress={() => void save()} />
          <Button testID="AdminLegalEditor.cancel" label={s.cancel} variant="outline" chevron={false} disabled={create.isPending} onPress={leave} />
        </View>
      </View>
    );
  }

  return (
    <>
      <Screen
        testID="AdminLegalEditor"
        header={<AdminHeader subtitle={s.subtitle} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} onBack={leave} testID="AdminLegalEditor.header" />}
        paddingX={14}
        contentContainerStyle={styles.content}
      >
        {body}
      </Screen>

      <OptionSheet<LegalDocumentKind>
        visible={kindOpen}
        title={s.kindSheet}
        options={LEGAL_KINDS.map((value) => ({ value, label: kinds[value] ?? value }))}
        selected={kind}
        onSelect={(value) => {
          touch();
          setKind(value);
          setKindOpen(false);
        }}
        onClose={() => setKindOpen(false)}
        testID="AdminLegalEditor.kindSheet"
      />
      <ConfirmDialog
        visible={discard}
        destructive
        title={s.discardTitle}
        message={s.discardMessage}
        confirmLabel={s.discardConfirm}
        cancelLabel={s.keepEditing}
        onConfirm={() => {
          setDiscard(false);
          setDirty(false);
          exit();
        }}
        onCancel={() => setDiscard(false)}
        testID="AdminLegalEditor.discardDialog"
      />
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
  content: { paddingTop: 12, paddingBottom: 24 },
  gapTop: { marginTop: 14 },
  gapTopSm: { marginTop: 8 },
  sectionsTitle: { marginTop: 22, marginBottom: 6 },
  sectionCard: { marginTop: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 4 },
  areaLabel: { marginTop: 10, marginBottom: 4 },
  sectionActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  actions: { marginTop: 22, gap: 10 },
});
