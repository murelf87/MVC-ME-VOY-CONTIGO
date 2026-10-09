import React from "react";
import { StyleSheet, View } from "react-native";
import { IconTile, type IconTileTone } from "@/icons";
import { Button, Card, Text, type SurfaceTone } from "@/ui";
import type { SharingAction, SharingCardModel, SharingTone } from "../logic/sharing";
import { opsStrings } from "../strings";

const SURFACE: Record<SharingTone, SurfaceTone> = { blue: "blue", amber: "amber", red: "red", gray: "gray", green: "green" };
const TILE: Record<SharingTone, IconTileTone> = { blue: "blue", amber: "amber", red: "red", gray: "gray", green: "green" };

const LABEL: Record<SharingAction, string> = {
  allow: opsStrings.sharing.permission.allow,
  settings: opsStrings.common.openSettings,
  continue_without: opsStrings.sharing.permission.continueWithout,
  resume: opsStrings.sharing.resume,
  retry: opsStrings.common.retry,
};

export interface SharingCardProps {
  model: SharingCardModel;
  onAction: (action: SharingAction) => void;
  testID?: string;
}

/**
 * Estado de la ubicación del conductor con una salida SIEMPRE disponible: permitir, abrir Ajustes, reintentar o
 * «Seguir sin compartir». Nunca bloquea el viaje.
 */
export function SharingCard({ model, onAction, testID = "SharingCard" }: SharingCardProps): React.JSX.Element | null {
  if (!model.visible) return null;
  return (
    <Card tone={SURFACE[model.tone]} padding={14} testID={testID} style={styles.card}>
      <View style={styles.head} accessible accessibilityRole="alert" accessibilityLabel={[model.title, model.detail].filter(Boolean).join(". ")}>
        <IconTile name={model.icon} tone={TILE[model.tone]} size={44} iconSize={24} />
        <View style={styles.text}>
          <Text variant="rowTitle" color="heading" size={18} lineHeight={22}>
            {model.title}
          </Text>
          {model.detail ? (
            <Text variant="body" color="body" size={16} lineHeight={20} style={styles.detail}>
              {model.detail}
            </Text>
          ) : null}
        </View>
      </View>
      {model.actions.length > 0 ? (
        <View style={styles.actions}>
          {model.actions.map((action, index) => (
            <Button
              key={action}
              testID={`${testID}.${action}`}
              label={LABEL[action]}
              variant={index === 0 ? "primary" : "outline"}
              size="sm"
              chevron={false}
              onPress={() => onAction(action)}
              style={index > 0 ? styles.nextAction : undefined}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 10 },
  head: { flexDirection: "row", alignItems: "flex-start" },
  text: { flex: 1, marginLeft: 12 },
  detail: { marginTop: 2 },
  actions: { marginTop: 12 },
  nextAction: { marginTop: 8 },
});
