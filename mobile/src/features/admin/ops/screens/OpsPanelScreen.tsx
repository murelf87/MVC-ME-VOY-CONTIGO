/**
 * Panel de tarifas y operación (lámina 40): cabecera «Panel MVC», cuatro pestañas (Tarifas · Operaciones · Alertas ·
 * Auditoría) y el contenido de la activa. `AdminTariffsOps`, `AdminAlerts` y `AdminAuditLog` son este mismo panel con
 * distinta pestaña inicial. RBAC: cada pestaña solo se puede leer con los roles que dice la matriz; si la pestaña pedida
 * no es para tu rol se abre la primera que sí lo es, y si ninguna, «Sin permiso».
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppScreenProps } from "@/navigation";
import { useAppNavigation } from "@/navigation";
import { colors } from "@/theme";
import { Screen } from "@/ui";
import { AccessSheet } from "../components/AccessSheet";
import { OpsHeader } from "../components/OpsHeader";
import { OpsTabs } from "../components/OpsTabs";
import { useAdminAccess } from "../hooks/useAdminAccess";
import { avatarInitial, canReadTab, firstAllowedTab, type OpsAccess, type OpsTab } from "../model/permissions";
import { opsStrings } from "../strings";
import { AlertsTab } from "./AlertsTab";
import { AuditTab } from "./AuditTab";
import { OperationsTab } from "./OperationsTab";
import { TariffsTab } from "./TariffsTab";

interface OpsPanelProps {
  testID: string;
  initialTab: OpsTab;
}

function TabBody({ tab, access }: { tab: OpsTab; access: OpsAccess }): React.JSX.Element {
  switch (tab) {
    case "tariffs":
      return <TariffsTab access={access} />;
    case "operations":
      return <OperationsTab access={access} />;
    case "alerts":
      return <AlertsTab access={access} />;
    case "audit":
      return <AuditTab access={access} />;
  }
}

function OpsPanel({ testID, initialTab }: OpsPanelProps): React.JSX.Element {
  const navigation = useAppNavigation();
  const access = useAdminAccess();
  const [requested, setRequested] = React.useState<OpsTab>(initialTab);
  const [sheet, setSheet] = React.useState(false);

  // Si cambia la pestaña inicial (otra ruta del mismo panel), se sigue.
  React.useEffect(() => {
    setRequested(initialTab);
  }, [initialTab]);

  const tab = canReadTab(access, requested) ? requested : firstAllowedTab(access, requested);
  const goBack = (): void => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("AdminHome");
  };

  return (
    <Screen
      testID={testID}
      scroll={false}
      padded={false}
      header={
        <View>
          <OpsHeader
            title={opsStrings.header.title}
            subtitle={opsStrings.header.tariffsSubtitle}
            initials={avatarInitial(access.displayName)}
            onBack={goBack}
            onAvatarPress={() => setSheet(true)}
            testID={`${testID}.header`}
          />
          <View style={styles.tabs}>
            <OpsTabs value={tab} onChange={setRequested} testID={`${testID}.tabs`} />
          </View>
        </View>
      }
    >
      <TabBody tab={tab} access={access} />
      <AccessSheet
        visible={sheet}
        access={access}
        onClose={() => setSheet(false)}
        onGoHome={() => {
          setSheet(false);
          navigation.navigate("AdminHome");
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { backgroundColor: colors.bg.screen },
});

/** Ruta `AdminTariffsOps` (lámina 40): abre en la pestaña pedida (por defecto, Tarifas). */
export function AdminTariffsOpsScreen({ route }: AppScreenProps<"AdminTariffsOps">): React.JSX.Element {
  return <OpsPanel testID="AdminTariffsOps" initialTab={route.params?.tab ?? "tariffs"} />;
}

/** Ruta `AdminAlerts`: el mismo panel, en la pestaña Alertas. */
export function AdminAlertsScreen(_props: AppScreenProps<"AdminAlerts">): React.JSX.Element {
  return <OpsPanel testID="AdminAlerts" initialTab="alerts" />;
}

/** Ruta `AdminAuditLog`: el mismo panel, en la pestaña Auditoría. */
export function AdminAuditLogScreen(_props: AppScreenProps<"AdminAuditLog">): React.JSX.Element {
  return <OpsPanel testID="AdminAuditLog" initialTab="audit" />;
}
