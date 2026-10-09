/**
 * 32 · Planes MVC. Cuenta gratuita (la activa, con visto verde), Premium Conductor («Propuesta», cuota y comisiones por
 * definir) y Membresía (no disponible, gris con candado). Todo el texto sale del servidor. NO existe compra: ninguna
 * tarjeta ofrece pagar; se dice claramente. Estados: cargando · error · sin conexión (copia guardada) · vacío.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { IconTile } from "@/icons/IconTile";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Banner, EmptyState, Screen, ScreenHeader, Text } from "@/ui";
import { ListSkeleton, LoadFailure, OfflineNotice } from "../components/ScreenStates";
import { useMyPlan, usePlans } from "../hooks/usePlans";
import { buildPlanCards, type PlanCardView } from "../model/plans";
import { profileStrings } from "../strings";

const copy = profileStrings.plans;
const SIDE = 14;

function FeatureList({ plan }: { plan: PlanCardView }): React.JSX.Element {
  const green = plan.look === "proposal";
  return (
    <View style={styles.features} testID={`Plans.features.${plan.code}`}>
      {plan.features.map((feature) => (
        <View key={feature} style={styles.featureRow} accessible accessibilityLabel={copy.featureA11y(feature)}>
          {green ? (
            <View style={styles.greenCheck}><Icon name="check" size={16} color="#FFFFFF" /></View>
          ) : (
            <View style={styles.blueCheck}><Icon name="checkBold" size={22} color={colors.primary} /></View>
          )}
          <Text variant="body" color="deep" size={18} lineHeight={22} style={styles.flex}>{feature}</Text>
        </View>
      ))}
    </View>
  );
}

function PlanCard({ plan }: { plan: PlanCardView }): React.JSX.Element {
  const unavailable = plan.look === "unavailable";
  const surface = plan.look === "active" ? styles.cardActive : plan.look === "proposal" ? styles.cardProposal : styles.cardUnavailable;
  const tone = plan.look === "active" ? "blue" : plan.look === "proposal" ? "green" : "gray";
  return (
    <View testID={`Plans.card.${plan.code}`} accessible accessibilityRole="summary" accessibilityLabel={plan.a11yLabel} style={unavailable ? styles.unavailableBlock : undefined}>
      <View style={[styles.card, unavailable ? styles.cardFlat : surface]}>
        <IconTile name={plan.icon} tone={tone} size={plan.look === "active" ? 48 : 58} iconSize={plan.look === "active" ? 32 : 36} shape="circle" />
        <View style={styles.flex}>
          <Text variant="titleSm" color={unavailable ? "muted" : "heading"} size={21} lineHeight={25} style={unavailable ? styles.grayText : undefined}>{plan.name}</Text>
          <Text variant="body" color={unavailable ? "muted" : "body"} size={17}>{plan.tagline}</Text>
        </View>
        {plan.tag !== null ? <View style={styles.tag}><Text variant="rowTextStrong" color="link" size={15}>{plan.tag}</Text></View> : null}
        {plan.current ? <View style={styles.currentDot} testID={`Plans.current.${plan.code}`} accessibilityLabel={copy.currentPlan}><Icon name="check" size={26} color="#FFFFFF" /></View> : null}
        {unavailable ? <Icon name="lock" size={32} color="#8A93A8" /> : null}
      </View>
      {plan.features.length > 0 ? <FeatureList plan={plan} /> : null}
      {plan.economicsNote !== null ? (
        <View style={styles.economics} testID={`Plans.economics.${plan.code}`}>
          <IconTile name="euro" tone="solidOrange" size={46} iconSize={28} shape="circle" />
          <View style={styles.flex}>
            <Text variant="titleSm" color="warning" size={19} lineHeight={23}>{plan.economicsNote.title}</Text>
            <Text variant="body" color="body" size={16.5}>{plan.economicsNote.detail}</Text>
          </View>
        </View>
      ) : null}
      {plan.availabilityNote !== null ? <Text variant="body" color="muted" size={16.5} lineHeight={22} style={styles.availability} testID={`Plans.availability.${plan.code}`}>{plan.availabilityNote}</Text> : null}
    </View>
  );
}

export function PlansScreen(_props: AppScreenProps<"Plans">): React.JSX.Element {
  const plans = usePlans();
  const mine = useMyPlan();
  const online = useIsOnline();
  const header = <ScreenHeader title={copy.title} testID="Plans.header" />;

  if (plans.data === undefined) {
    return (
      <Screen testID="Plans" header={header} padded={false}>
        {plans.error ? <LoadFailure testID="Plans.error" title={copy.loadErrorTitle} error={plans.error} onRetry={() => void plans.refetch()} /> : <ListSkeleton testID="Plans.loading" count={3} />}
      </Screen>
    );
  }

  const cards = buildPlanCards(plans.data.items, mine.data?.planCode ?? null);
  return (
    <Screen testID="Plans" header={header} padded={false} refreshing={plans.isRefreshing} onRefresh={() => { void plans.refetch(); void mine.refetch(); }}>
      <View style={styles.body}>
        {plans.isOffline || !online ? <OfflineNotice testID="Plans.offline" detail={copy.stale} onRetry={() => void plans.refetch()} style={styles.gap} /> : null}
        {cards.length === 0 ? (
          <EmptyState testID="Plans.empty" icon="info" title={copy.emptyTitle} message={copy.emptyMessage} variant="plain" />
        ) : (
          cards.map((card, index) => (
            <View key={card.code} style={index === 0 ? undefined : styles.cardGap}>
              <PlanCard plan={card} />
            </View>
          ))
        )}
        <Banner testID="Plans.noPurchase" kind="info" size="sm" title={copy.noPurchase} style={styles.cardGap} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingHorizontal: SIDE, paddingTop: 6, paddingBottom: 28 },
  gap: { marginBottom: 10 },
  cardGap: { marginTop: 16 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 18, borderWidth: 1 },
  cardActive: { backgroundColor: colors.bg.tint, borderColor: colors.border.soft },
  cardProposal: { backgroundColor: "#DDF6EC", borderColor: "#C8EEDD" },
  cardUnavailable: { backgroundColor: "#EEF0F6", borderColor: "#E1E4EC" },
  unavailableBlock: { borderRadius: 18, borderWidth: 1, backgroundColor: "#EEF0F6", borderColor: "#E1E4EC", paddingBottom: 14 },
  cardFlat: { backgroundColor: "transparent", borderColor: "transparent" },
  grayText: { color: "#7C86A0" },
  tag: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: "#FFFFFF" },
  currentDot: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand.green, alignItems: "center", justifyContent: "center" },
  features: { paddingHorizontal: 12, paddingTop: 12, gap: 6 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  blueCheck: { width: 26, alignItems: "center" },
  greenCheck: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#0E9F6E", alignItems: "center", justifyContent: "center" },
  economics: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 14, padding: 12, borderRadius: 16, backgroundColor: "#FDEBDD" },
  availability: { marginTop: 4, paddingHorizontal: 14 },
});
