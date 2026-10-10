/**
 * Información legal (pública): la última versión de cada documento (términos, privacidad, cancelación y privacidad de la
 * comprobación), con su estado real. Un texto pendiente de revisión jurídica se dice así y no se presenta como vigente.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { LegalDocumentSummary } from "@/api/types";
import { formatDateShort } from "@/i18n";
import type { AppScreenProps } from "@/navigation/types";
import { Screen, ScreenHeader, SkeletonList, StatusPill, Text } from "@/ui";
import { LoadError } from "../components/StateCards";
import { SettingsRow } from "../components/SettingsRows";
import { useLegalDocuments } from "../hooks/useLegal";
import { helpStrings } from "../strings";
import { isOfflineError } from "@/api";

const t = helpStrings.legal;

function pill(doc: LegalDocumentSummary): { label: string; tone: "amber" | "green" | "gray" } {
  if (doc.pendingLegalReview) return { label: t.pendingPill, tone: "amber" };
  if (doc.status === "retired") return { label: t.retiredPill, tone: "gray" };
  return { label: t.effectivePill, tone: "green" };
}

export function LegalCenterScreen({ navigation }: AppScreenProps<"LegalCenter">): React.JSX.Element {
  const query = useLegalDocuments();
  const docs = query.data;
  return (
    <Screen testID="LegalCenter" header={<ScreenHeader title={t.centerTitle} testID="LegalCenter.header" />} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <Text variant="body" color="muted" size={16} style={styles.intro}>{t.centerIntro}</Text>
      {docs === undefined && !query.isError && !query.isOffline ? <SkeletonList testID="LegalCenter.loading" count={4} variant="row" /> : null}
      {docs === undefined && (query.isError || query.isOffline) ? <LoadError testID="LegalCenter.error" title={t.listErrorTitle} offline={isOfflineError(query.error) || query.isOffline} onRetry={() => void query.refetch()} /> : null}
      {docs?.map((doc) => {
        const p = pill(doc);
        return (
          <View key={doc.kind} style={styles.item}>
            <SettingsRow
              testID={`LegalCenter.doc.${doc.kind}`}
              icon="documentOutline"
              title={t.kindTitles[doc.kind] ?? doc.title}
              subtitle={t.kindSubtitles[doc.kind] ?? ""}
              tone="white"
              onPress={() => navigation.navigate("LegalDocument", { kind: doc.kind })}
            />
            <View style={styles.meta}>
              <StatusPill label={p.label} tone={p.tone} size="sm" />
              <Text variant="body" color="muted" size={14}>{`${t.version(doc.version)} · ${doc.publishedAt !== null ? t.publishedAt(formatDateShort(doc.publishedAt)) : t.noDate}`}</Text>
            </View>
          </View>
        );
      })}
      <Text variant="body" color="link" size={15.5} accessibilityRole="link" onPress={() => navigation.navigate("HelpCenter")} style={styles.help} testID="LegalCenter.help">{t.helpLink}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: 12 },
  item: { marginBottom: 12 },
  meta: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 6, paddingTop: 6, flexWrap: "wrap" },
  help: { marginTop: 8, textDecorationLine: "underline" },
});
