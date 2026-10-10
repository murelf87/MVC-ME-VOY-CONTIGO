/**
 * Documento legal (público): título, versión, fechas, aviso de «pendiente de revisión jurídica» cuando toca y las
 * secciones (títulos, párrafos y listas). Se puede abrir la versión vigente o una concreta.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { isApiError, isOfflineError } from "@/api";
import { formatDateShort } from "@/i18n";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Banner, EmptyState, Screen, ScreenHeader, SkeletonList, StatusPill, Text } from "@/ui";
import { LoadError } from "../components/StateCards";
import { useLegalDocument } from "../hooks/useLegal";
import { helpStrings } from "../strings";

const t = helpStrings.legal;

export function LegalDocumentScreen({ navigation, route }: AppScreenProps<"LegalDocument">): React.JSX.Element {
  const { kind, version } = route.params;
  const query = useLegalDocument(kind, version);
  const doc = query.data;
  const header = <ScreenHeader title={t.kindTitles[kind] ?? t.documentTitle} testID="LegalDocument.header" />;

  if (doc === undefined) {
    const notFound = isApiError(query.error) && query.error.status === 404;
    return (
      <Screen testID="LegalDocument" header={header}>
        {notFound ? (
          <EmptyState testID="LegalDocument.notFound" icon="alertCircle" variant="plain" title={t.notFoundTitle} message={t.notFoundMessage} actionLabel={t.notFoundAction} onAction={() => navigation.navigate("LegalCenter")} />
        ) : query.isError || query.isOffline ? (
          <LoadError testID="LegalDocument.error" title={t.loadErrorTitle} offline={isOfflineError(query.error) || query.isOffline} onRetry={() => void query.refetch()} />
        ) : (
          <SkeletonList testID="LegalDocument.loading" count={4} variant="row" />
        )}
      </Screen>
    );
  }

  const status = doc.pendingLegalReview ? { label: t.pendingPill, tone: "amber" as const } : doc.status === "retired" ? { label: t.retiredPill, tone: "gray" as const } : { label: t.effectivePill, tone: "green" as const };
  return (
    <Screen testID="LegalDocument" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      <Text variant="heading" color="heading" size={22} lineHeight={28} accessibilityRole="header">{doc.title}</Text>
      <View style={styles.meta}>
        <StatusPill label={status.label} tone={status.tone} size="sm" />
        <Text variant="body" color="muted" size={14.5}>{t.version(doc.version)}</Text>
      </View>
      <Text variant="body" color="muted" size={14.5} testID="LegalDocument.dates">
        {doc.effectiveFrom !== null ? t.effectiveFrom(formatDateShort(doc.effectiveFrom)) : doc.publishedAt !== null ? t.publishedAt(formatDateShort(doc.publishedAt)) : t.noDate}
      </Text>
      {doc.pendingLegalReview ? <Banner testID="LegalDocument.reviewBanner" kind="warning" title={t.pendingBannerTitle} message={t.pendingBannerMessage} style={styles.banner} /> : null}
      {doc.sections.length === 0 ? <EmptyState testID="LegalDocument.empty" icon="documentOutline" variant="plain" title={t.emptySectionsTitle} message={t.emptySectionsMessage} /> : null}
      {doc.sections.map((section, index) => (
        <View key={`${index}-${section.heading}`} style={styles.section} testID={`LegalDocument.section.${index}`}>
          <Text variant="titleSm" color="heading" size={19} accessibilityRole="header">{section.heading}</Text>
          {section.paragraphs.map((p, i) => <Text key={`p${i}`} variant="body" color="body" size={16} lineHeight={22} style={styles.p}>{p}</Text>)}
          {section.bullets.map((b, i) => (
            <View key={`b${i}`} style={styles.bullet}>
              <Text variant="body" color="body" size={16}>{"•"}</Text>
              <Text variant="body" color="body" size={16} lineHeight={22} style={styles.flex}>{b}</Text>
            </View>
          ))}
        </View>
      ))}
      <Text variant="body" color="link" size={15.5} accessibilityRole="link" onPress={() => navigation.navigate("HelpCenter")} style={styles.help} testID="LegalDocument.help">{t.helpLink}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  meta: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 4 },
  banner: { marginTop: 12 },
  section: { marginTop: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border.default },
  p: { marginTop: 8 },
  bullet: { flexDirection: "row", gap: 8, marginTop: 6, paddingLeft: 6 },
  help: { marginTop: 24, textDecorationLine: "underline" },
});
