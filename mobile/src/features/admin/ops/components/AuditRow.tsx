/**
 * Evento de auditoría: qué pasó (en español), quién lo hizo y cuándo; desplegable con la entidad, la petición y los
 * metadatos que el SERVIDOR ya ha depurado de datos personales («[oculto]»). Atajos para filtrar por esa persona o entidad.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { AdminAuditEvent } from "@/api/types";
import { formatDateTime } from "@/i18n";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Button, StatusPill, Text } from "@/ui";
import { actionLabel, actorName, metadataRows } from "../model/audit";
import { opsStrings } from "../strings";

export interface AuditRowProps {
  event: AdminAuditEvent;
  expanded: boolean;
  onToggle: () => void;
  onFilterActor: (actorId: string) => void;
  onFilterEntity: (entityType: string, entityId: string) => void;
  testID: string;
}

function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…` : id;
}

export function AuditRow({ event, expanded, onToggle, onFilterActor, onFilterEntity, testID }: AuditRowProps): React.JSX.Element {
  const a = opsStrings.audit;
  const label = actionLabel(event.action);
  const actor = actorName(event, opsStrings.common.system, opsStrings.common.noName);
  const rows = metadataRows(event.metadata);
  const when = formatDateTime(event.createdAt);
  return (
    <View style={styles.card} testID={testID}>
      <Pressable
        testID={`${testID}.toggle`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${label ?? event.action}. ${actor}. ${when}`}
        accessibilityHint={expanded ? a.detailsHide : a.detailsShow}
        onPress={onToggle}
        style={styles.head}
      >
        <View style={styles.headTexts}>
          <Text variant="rowTitle" size={15.8} lineHeight={20} color={colors.heading} testID={`${testID}.title`}>
            {label ?? event.action}
          </Text>
          {label !== null ? (
            <Text variant="caption" size={12} lineHeight={15} color={colors.text.subtle} testID={`${testID}.code`}>
              {event.action}
            </Text>
          ) : null}
          <Text variant="rowText" size={14} lineHeight={18} color={colors.text.muted} style={styles.line} testID={`${testID}.who`}>
            {`${a.rowActor(actor)} · ${when}`}
          </Text>
          <View style={styles.tags}>
            <StatusPill label={event.entityId !== null ? `${event.entityType} · ${shortId(event.entityId)}` : event.entityType} tone="gray" size="sm" />
            {event.redactions > 0 ? <StatusPill label={a.redactions(event.redactions)} tone="blue" icon="lock" size="sm" testID={`${testID}.redactions`} /> : null}
          </View>
        </View>
        <Icon name={expanded ? "chevronUp" : "chevronDown"} size={20} color={colors.primary} />
      </Pressable>
      {expanded ? (
        <View style={styles.details} testID={`${testID}.details`}>
          <DetailLine label={a.entity} value={event.entityId !== null ? `${event.entityType} · ${event.entityId}` : event.entityType} />
          <DetailLine label={a.request} value={event.requestId ?? opsStrings.common.none} />
          <DetailLine label={a.eventId} value={event.id} />
          <Text variant="rowTitle" size={14} lineHeight={18} color={colors.heading} style={styles.metaTitle}>
            {a.metadata}
          </Text>
          {rows.length === 0 ? (
            <Text variant="caption" size={12.6} lineHeight={16} color={colors.text.muted}>
              {a.noMetadata}
            </Text>
          ) : (
            rows.map((row) => (
              <View key={row.key} style={styles.metaRow} testID={`${testID}.meta.${row.key}`}>
                <Text variant="rowText" size={13.5} lineHeight={17} color={colors.text.muted} style={styles.metaKey}>
                  {row.key}
                </Text>
                <Text variant="rowTextStrong" size={13.5} lineHeight={17} color={row.hidden ? colors.text.subtle : colors.text.strong} style={styles.metaValue}>
                  {row.value}
                </Text>
              </View>
            ))
          )}
          <View style={styles.actions}>
            {event.actor !== null ? (
              <Button
                testID={`${testID}.onlyActor`}
                label={a.onlyThisPerson}
                variant="outline"
                size="sm"
                inline
                chevron={false}
                onPress={() => {
                  if (event.actor !== null) onFilterActor(event.actor.id);
                }}
              />
            ) : null}
            {event.entityId !== null ? (
              <Button
                testID={`${testID}.onlyEntity`}
                label={a.onlyThisEntity}
                variant="outline"
                size="sm"
                inline
                chevron={false}
                onPress={() => {
                  if (event.entityId !== null) onFilterEntity(event.entityType, event.entityId);
                }}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.detailLine} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="rowText" size={13.5} lineHeight={17} color={colors.text.muted} style={styles.detailLabel}>
        {label}
      </Text>
      <Text variant="rowTextStrong" size={13.5} lineHeight={17} color={colors.text.strong} style={styles.detailValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.white,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 16,
    overflow: "hidden",
  },
  head: { minHeight: 64, flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, paddingLeft: 13, paddingRight: 10 },
  headTexts: { flex: 1, paddingRight: 8 },
  line: { marginTop: 4 },
  tags: { flexDirection: "row", flexWrap: "wrap", columnGap: 6, rowGap: 4, marginTop: 8 },
  details: { borderTopWidth: 1, borderTopColor: colors.border.divider, paddingVertical: 10, paddingHorizontal: 13, backgroundColor: colors.bg.tintSoft },
  detailLine: { flexDirection: "row", columnGap: 10, minHeight: 22, alignItems: "flex-start" },
  detailLabel: { width: 74 },
  detailValue: { flex: 1 },
  metaTitle: { marginTop: 10, marginBottom: 4 },
  metaRow: { flexDirection: "row", columnGap: 10, minHeight: 22, alignItems: "flex-start" },
  metaKey: { width: 120 },
  metaValue: { flex: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 6, marginTop: 12 },
});
