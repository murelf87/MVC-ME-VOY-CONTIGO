import React from "react";
import { StyleSheet, View } from "react-native";
import type { IconName } from "@/icons";
import type { AppScreenProps } from "@/navigation";
import { Button, Screen, Text } from "@/ui";
import { LinkRow } from "../../ops/components/PanelCard";
import { AdminHeader } from "../components/AdminHeader";
import { CheckingAccess, NoPermission, PanelError } from "../components/AccessStates";
import { StaffAccessSheet } from "../components/StaffAccessSheet";
import { useAdminGate } from "../hooks/useAdminGate";
import { useHomeCounts } from "../hooks/useHomeCounts";
import { homeSections, rolesText, staffFirstName, staffInitial, type HomeSectionKey } from "../logic/permissions";
import { reviewStrings } from "../strings";

const h = reviewStrings.home;

const ICONS: Record<HomeSectionKey, IconName> = {
  summary: "chart",
  users: "shield",
  bookings: "receipt",
  tariffs: "euro",
  payouts: "coins",
  alerts: "bell",
  audit: "opsClipboardClock",
  legal: "document",
  support: "opsHeadset",
};

/**
 * Inicio del panel de administración (sin lámina; mismo lenguaje que 37–40): saluda, dice qué roles tiene la persona y
 * enseña solo las secciones que su rol puede abrir, con el contador de lo que espera (revisiones, devoluciones).
 */
export function AdminHomeScreen({ navigation }: AppScreenProps<"AdminHome">): React.JSX.Element {
  const gate = useAdminGate(() => true);
  const { access } = gate;
  const sections = homeSections(access.me);
  const counts = useHomeCounts({ reviews: sections.some((s) => s.key === "users"), refunds: access.bookingsSource === "refunds" });

  const extra = (key: HomeSectionKey): string | null => {
    if (key === "users" && counts.pendingReviews !== null) return h.pendingReviews(counts.pendingReviews);
    if (key === "bookings" && counts.openRefunds !== null) return h.openRefunds(counts.openRefunds);
    return null;
  };

  let body: React.ReactNode;
  if (gate.state === "checking") body = <CheckingAccess />;
  else if (gate.state === "error" && gate.error !== null) body = <PanelError error={gate.error} onRetry={gate.retry} onGoHome={gate.retry} testID="AdminHome.error" />;
  else if (gate.state === "denied" || sections.length === 0) {
    body = <NoPermission testID="AdminHome.denied" title={h.noAccessTitle} message={h.noAccessMessage} onGoHome={() => navigation.navigate("MapHome")} />;
  } else {
    const first = staffFirstName(access.me);
    body = (
      <>
        <Text variant="titleSm" color="heading" size={22} lineHeight={28} testID="AdminHome.greeting">{first !== null ? h.greeting(first) : h.greetingUnknown}</Text>
        <Text variant="body" color="body" size={16} style={styles.intro}>{h.intro}</Text>
        <Text variant="body" color="muted" size={15} style={styles.intro} testID="AdminHome.roles">{h.rolesLine(rolesText(access.me))}</Text>
        <Text variant="rowTitle" color="heading" size={17} style={styles.sectionTitle}>{h.sectionsTitle}</Text>
        <View style={styles.list} testID="AdminHome.sections">
          {sections.map((section) => (
            <LinkRow
              key={section.key}
              testID={`AdminHome.section.${section.key}`}
              icon={ICONS[section.key]}
              title={section.title}
              subtitle={extra(section.key) !== null ? `${section.subtitle} · ${extra(section.key)}` : section.subtitle}
              onPress={() => navigation.navigate(section.route as never)}
            />
          ))}
        </View>
        <Button testID="AdminHome.myAccess" label={h.yourAccess} variant="outline" chevron={false} onPress={gate.openSheet} style={styles.access} />
      </>
    );
  }

  return (
    <>
      <Screen
        testID="AdminHome"
        header={<AdminHeader subtitle={h.subtitle} initial={staffInitial(access.me)} staffName={access.me?.displayName ?? null} onAvatarPress={gate.openSheet} hideBack testID="AdminHome.header" />}
        paddingX={11}
        contentContainerStyle={styles.content}
      >
        {body}
      </Screen>
      <StaffAccessSheet visible={gate.sheetOpen} onClose={gate.closeSheet} me={access.me} loading={access.query.isLoading || access.query.isIdle} error={gate.error} onRetry={gate.retry} onGoHome={gate.closeSheet} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 14, paddingBottom: 24, paddingHorizontal: 4 },
  intro: { marginTop: 6 },
  sectionTitle: { marginTop: 22, marginBottom: 10 },
  list: { gap: 10 },
  access: { marginTop: 22 },
});
