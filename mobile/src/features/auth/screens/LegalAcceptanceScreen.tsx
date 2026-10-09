import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { describeError, isApiError } from "@/api/errors";
import type { LegalStatus, LegalStatusItem } from "@/api/types/trust";
import { queryCache, useApiQuery, useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { applyGate, useAppNavigation, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Banner, Button, Card, Checkbox, EmptyState, ErrorStateCard, OfflineBanner, Screen, ScreenHeader, Skeleton, Text } from "@/ui";
import { acceptLegal, getLegalStatus } from "../api";
import { AuthButton } from "../components/AuthButton";
import { acceptancePlan, missingAccountItems, pendingReviewIn } from "../logic/legal";
import { authStrings } from "../strings";

const copy = authStrings.legal;
const STATUS_KEY = ["auth", "legal", "status"] as const;

/**
 * Condiciones y privacidad. Aparece cuando hay una versión vigente de los Términos o de la Política de privacidad
 * que la persona no ha aceptado. Cada documento se puede leer entero (pantalla «Documento legal»); «Aceptar y
 * continuar» registra la aceptación de la versión exacta que se está viendo. Los textos todavía pendientes de revisión
 * jurídica se señalan como tales.
 */
export function LegalAcceptanceScreen(_props: AppScreenProps<"LegalAcceptance">): React.JSX.Element {
  const navigation = useAppNavigation();
  const online = useIsOnline();
  const { isGuest } = useAuth();
  const query = useApiQuery<LegalStatus>(STATUS_KEY, ({ signal }) => getLegalStatus({ signal }), { enabled: !isGuest, staleTimeMs: 0 });
  const missing = useMemo(() => (query.data !== undefined ? missingAccountItems(query.data) : []), [query.data]);
  const pending = pendingReviewIn(missing);

  const [checked, setChecked] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [outdated, setOutdated] = useState(false);

  const leave = useCallback(() => {
    const decision = applyGate();
    if (decision === null && navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const accept = useCallback(async () => {
    if (saving) return;
    setError(null);
    if (!checked) {
      setShowRequired(true);
      return;
    }
    setSaving(true);
    try {
      for (const entry of acceptancePlan(missing)) {
        await acceptLegal({ kind: entry.kind, version: entry.version, context: "account" });
      }
      await queryCache.invalidate(["auth"]);
      leave();
    } catch (failure) {
      if (isApiError(failure) && (failure.code === "LEGAL_VERSION_OUTDATED" || failure.code === "LEGAL_DOCUMENT_RETIRED")) {
        setOutdated(true);
        setChecked(false);
        await query.refetch();
      } else {
        const described = describeError(failure);
        setError({ title: copy.acceptFailedTitle, message: described.message });
      }
    } finally {
      setSaving(false);
    }
  }, [checked, leave, missing, query, saving]);

  const read = useCallback(
    (item: LegalStatusItem) => navigation.navigate("LegalDocument", { kind: item.kind, version: item.latestVersion }),
    [navigation],
  );

  if (isGuest) {
    return (
      <Screen testID="LegalAcceptance" padded={false} header={<ScreenHeader title={copy.title} testID="LegalAcceptance.header" />}>
        <View style={styles.pad}>
          <EmptyState title={copy.guestTitle} message={copy.guestMessage} actionLabel={authStrings.common.createAccount} onAction={() => navigation.navigate("ChooseRole", undefined)} testID="LegalAcceptance.guest" />
        </View>
      </Screen>
    );
  }

  const empty = query.data !== undefined && missing.length === 0;
  return (
    <Screen
      testID="LegalAcceptance"
      padded={false}
      header={<ScreenHeader title={copy.title} testID="LegalAcceptance.header" />}
      footer={
        empty ? (
          <AuthButton size="compact" label={copy.done} onPress={leave} style={styles.footer} testID="LegalAcceptance.done" />
        ) : (
          <AuthButton size="compact" label={copy.accept} onPress={() => void accept()} loading={saving} disabled={!online || missing.length === 0} style={styles.footer} testID="LegalAcceptance.accept" />
        )
      }
    >
      {!online ? <OfflineBanner testID="LegalAcceptance.offline" /> : null}

      {!empty ? (
        <Text variant="subtitle" color="muted" align="center" size={18.5} lineHeight={24} style={styles.intro}>
          {copy.intro}
        </Text>
      ) : null}

      <View style={styles.pad} accessibilityLiveRegion="polite">
        {query.isLoading && query.data === undefined ? (
          <>
            <Skeleton height={96} />
            <Skeleton height={96} />
          </>
        ) : null}
        {query.isError && query.data === undefined ? (
          <ErrorStateCard title={copy.loadFailedTitle} message={describeError(query.error).message} actionLabel={authStrings.common.retry} onAction={() => void query.refetch()} testID="LegalAcceptance.loadError" />
        ) : null}
        {empty ? <EmptyState title={copy.emptyTitle} message={copy.emptyMessage} testID="LegalAcceptance.empty" /> : null}
        {outdated ? <Banner kind="notice" size="sm" message={copy.outdated} testID="LegalAcceptance.outdated" /> : null}
        {pending ? <Banner kind="notice" size="sm" title={copy.pendingReviewTitle} message={copy.pendingReview} testID="LegalAcceptance.pending" /> : null}

        {missing.map((item) => (
          <Card key={`${item.kind}-${item.latestVersion}`} tone="blue" padding={0} radius={18} testID={`LegalAcceptance.doc.${item.kind}`}>
            <View style={styles.docHead}>
              <View style={styles.docIcon}>
                <Icon name="document" size={26} color={colors.primary} />
              </View>
              <View style={styles.docText}>
                <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{copy.kinds[item.kind]}</Text>
                <Text variant="caption" color="muted">
                  {item.pendingLegalReview ? `${copy.version(item.latestVersion)} · ${copy.pendingBadge}` : copy.version(item.latestVersion)}
                </Text>
              </View>
            </View>
            <View style={styles.docAction}>
              <Button label={copy.read} variant="outline" size="sm" onPress={() => read(item)} testID={`LegalAcceptance.read.${item.kind}`} />
            </View>
          </Card>
        ))}

        {missing.length > 0 ? (
          <View style={styles.consent}>
            <Checkbox
              checked={checked}
              onChange={(value) => {
                setChecked(value);
                if (value) setShowRequired(false);
              }}
              error={showRequired && !checked}
              disabled={saving}
              label={copy.consent}
              testID="LegalAcceptance.consent"
            />
            {showRequired && !checked ? (
              <Text variant="caption" color="error" accessibilityRole="alert" testID="LegalAcceptance.consentRequired">
                {copy.consentRequired}
              </Text>
            ) : null}
          </View>
        ) : null}

        {saving ? <Text variant="subtitle" color="muted" align="center" testID="LegalAcceptance.saving">{copy.accepting}</Text> : null}
        {error !== null ? <Banner kind="error" size="sm" title={error.title} message={error.message} actionLabel={authStrings.common.retry} onAction={() => void accept()} testID="LegalAcceptance.error" /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  intro: { marginTop: 8, paddingHorizontal: 28 },
  docHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingTop: 14 },
  docIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bg.white, alignItems: "center", justifyContent: "center" },
  docText: { flex: 1 },
  docAction: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, alignItems: "flex-start" },
  consent: { marginTop: 6, gap: 4 },
  footer: { marginHorizontal: 16 },
});
