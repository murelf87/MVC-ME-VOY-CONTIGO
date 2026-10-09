/**
 * Filtros avanzados de la auditoría: acción (exacta o con prefijo `*`), persona, tipo e identificador de entidad y rango
 * de fechas (días naturales de Madrid). Valida en español antes de aplicar; «Quitar filtros» vuelve al estado inicial.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheet, Button, TextField } from "@/ui";
import { EMPTY_AUDIT_FILTER, validateAuditFilter, type AuditFilter, type AuditFilterErrors } from "../model/audit";
import { opsStrings } from "../strings";

export interface AuditFilterSheetProps {
  visible: boolean;
  filter: AuditFilter;
  onApply: (filter: AuditFilter) => void;
  onClear: () => void;
  onClose: () => void;
}

export function AuditFilterSheet({ visible, filter, onApply, onClear, onClose }: AuditFilterSheetProps): React.JSX.Element {
  const a = opsStrings.audit;
  const [draft, setDraft] = React.useState<AuditFilter>(filter);
  const [errors, setErrors] = React.useState<AuditFilterErrors>({});

  React.useEffect(() => {
    if (visible) {
      setDraft(filter);
      setErrors({});
    }
  }, [visible, filter]);

  const set = (field: keyof AuditFilter, text: string): void => {
    setDraft((current) => ({ ...current, [field]: text }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const apply = (): void => {
    const result = validateAuditFilter(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onApply(draft);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={a.filtersTitle}
      subtitle={a.filtersSubtitle}
      testID="OpsAuditFilterSheet"
      footer={
        <View>
          <Button label={a.apply} chevron={false} onPress={apply} testID="OpsAuditFilterSheet.apply" />
          <Button
            label={a.clear}
            variant="outline"
            chevron={false}
            onPress={() => {
              setDraft({ ...EMPTY_AUDIT_FILTER });
              setErrors({});
              onClear();
            }}
            testID="OpsAuditFilterSheet.clear"
            style={styles.second}
          />
        </View>
      }
    >
      <TextField
        testID="OpsAuditFilterSheet.action"
        label={a.actionLabel}
        variant="labeled"
        value={draft.action}
        onChangeText={(text) => set("action", text)}
        placeholder={a.actionPlaceholder}
        helper={a.actionHelper}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={101}
        error={errors.action}
      />
      <TextField
        testID="OpsAuditFilterSheet.actor"
        label={a.actorLabel}
        variant="labeled"
        value={draft.actorUserId}
        onChangeText={(text) => set("actorUserId", text)}
        placeholder={a.actorPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={36}
        error={errors.actorUserId}
        style={styles.field}
      />
      <TextField
        testID="OpsAuditFilterSheet.entityType"
        label={a.entityTypeLabel}
        variant="labeled"
        value={draft.entityType}
        onChangeText={(text) => set("entityType", text)}
        placeholder={a.entityTypePlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={60}
        error={errors.entityType}
        style={styles.field}
      />
      <TextField
        testID="OpsAuditFilterSheet.entityId"
        label={a.entityIdLabel}
        variant="labeled"
        value={draft.entityId}
        onChangeText={(text) => set("entityId", text)}
        placeholder={a.entityIdPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={100}
        error={errors.entityId}
        style={styles.field}
      />
      <TextField
        testID="OpsAuditFilterSheet.from"
        label={a.fromLabel}
        variant="labeled"
        value={draft.from}
        onChangeText={(text) => set("from", text)}
        placeholder={a.datePlaceholder}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={errors.from}
        style={styles.field}
      />
      <TextField
        testID="OpsAuditFilterSheet.to"
        label={a.toLabel}
        variant="labeled"
        value={draft.to}
        onChangeText={(text) => set("to", text)}
        placeholder={a.datePlaceholder}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={errors.to}
        style={styles.field}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: 12 },
  second: { marginTop: 10 },
});
