/**
 * Pestaña «Operaciones»: las restricciones de producto y las reglas de alerta en tiempo real con sus umbrales
 * (lectura Administración, Finanzas y Atención; edición solo Administración) y accesos a las demás herramientas del panel,
 * cada uno solo para los roles que lo pueden usar.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useAppNavigation } from "@/navigation";
import type { IconName } from "@/icons";
import { colors } from "@/theme";
import { Text } from "@/ui";
import { OperationsPanel } from "../components/OperationsPanel";
import { LinkRow } from "../components/PanelCard";
import { NoPermissionState } from "../components/StateViews";
import { TabScroll } from "../components/TabScroll";
import { useOperations } from "../hooks/useOperations";
import type { OpsAccess } from "../model/permissions";
import { opsStrings } from "../strings";

type ToolRoute = "AdminTariffVersions" | "AdminPayoutRuns" | "AdminLegalDocs" | "AdminSupportQueue";

interface ToolLink {
  key: string;
  icon: IconName;
  title: string;
  subtitle: string;
  route: ToolRoute;
}

export function OperationsTab({ access }: { access: OpsAccess }): React.JSX.Element {
  const navigation = useAppNavigation();
  const operations = useOperations(access.readOperations);
  const o = opsStrings.operations;

  if (!access.readOperations) {
    return (
      <TabScroll testID="OpsOperations">
        <NoPermissionState section={opsStrings.tabs.operations} testID="OpsOperations.noPermission" />
      </TabScroll>
    );
  }

  const links: ToolLink[] = [];
  if (access.readTariffs) links.push({ key: "versions", icon: "opsHistory", title: o.linkVersions.title, subtitle: o.linkVersions.subtitle, route: "AdminTariffVersions" });
  if (access.payouts) links.push({ key: "payouts", icon: "coins", title: o.linkPayouts.title, subtitle: o.linkPayouts.subtitle, route: "AdminPayoutRuns" });
  if (access.readLegal) links.push({ key: "legal", icon: "opsScale", title: o.linkLegal.title, subtitle: o.linkLegal.subtitle, route: "AdminLegalDocs" });
  if (access.readSupport) links.push({ key: "support", icon: "opsHeadset", title: o.linkSupport.title, subtitle: o.linkSupport.subtitle, route: "AdminSupportQueue" });

  return (
    <TabScroll
      testID="OpsOperations"
      refreshing={operations.isRefreshing}
      onRefresh={() => {
        void operations.refetch();
      }}
    >
      <Text variant="rowText" size={14} lineHeight={19} color={colors.text.muted} testID="OpsOperations.intro" style={styles.intro}>
        {o.rulesIntro}
      </Text>
      <OperationsPanel access={access} variant="detail" testID="OpsOperations.panel" />
      {links.length > 0 ? (
        <View style={styles.tools}>
          <Text variant="heading" size={18} lineHeight={22} color="heading" accessibilityRole="header" style={styles.toolsTitle}>
            {o.linksTitle}
          </Text>
          {links.map((link, index) => (
            <LinkRow
              key={link.key}
              icon={link.icon}
              title={link.title}
              subtitle={link.subtitle}
              onPress={() => navigation.navigate(link.route)}
              testID={`OpsOperations.link.${link.key}`}
              style={index > 0 ? styles.linkGap : undefined}
            />
          ))}
        </View>
      ) : null}
    </TabScroll>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: 4 },
  tools: { marginTop: 22 },
  toolsTitle: { marginBottom: 10, paddingHorizontal: 4 },
  linkGap: { marginTop: 8 },
});
