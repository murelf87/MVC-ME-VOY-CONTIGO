import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { images, type ImageAsset } from "@/assets";
import { Icon, iconNames } from "@/icons";
import { MvcLogo } from "@/brand";
import { colors, typography, type TextVariant } from "@/theme";
import { Text } from "@/ui";
import { Demo, Group, Swatch, Wrap } from "../GalleryParts";

/** Aplana `colors` en pares `ruta → valor` (solo cadenas). */
function flatten(prefix: string, node: unknown, out: Array<[string, string]>): void {
  if (typeof node === "string") {
    out.push([prefix, node]);
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      flatten(prefix === "" ? key : `${prefix}.${key}`, value, out);
    }
  }
}

const colorGroups: ReadonlyArray<{ title: string; keys: readonly string[] }> = [
  { title: "Acción y marca", keys: ["primary", "primaryPressed", "primaryDisabled", "onPrimary", "heading", "brand"] },
  { title: "Texto", keys: ["text"] },
  { title: "Fondos", keys: ["bg"] },
  { title: "Bordes", keys: ["border"] },
  { title: "Éxito", keys: ["success"] },
  { title: "Advertencia y aviso", keys: ["warning", "amber", "notice"] },
  { title: "Error", keys: ["error"] },
  { title: "Información, grises y otros", keys: ["info", "gray", "empty", "nav", "icon", "shadow"] },
  { title: "Baldosas, píldoras y botones suaves", keys: ["tile", "pill", "soft"] },
  { title: "Superficies, controles y días", keys: ["surface", "control", "daypill"] },
];

export function ColorsSection(): React.JSX.Element {
  return (
    <View>
      {colorGroups.map((group) => {
        const pairs: Array<[string, string]> = [];
        for (const key of group.keys) {
          flatten(key, (colors as Record<string, unknown>)[key], pairs);
        }
        return (
          <Group key={group.title} title={group.title}>
            {pairs.map(([path, value]) => (
              <Swatch key={path} path={`colors.${path}`} value={value} />
            ))}
          </Group>
        );
      })}
    </View>
  );
}

const sampleText: Partial<Record<TextVariant, string>> = {
  display: "Tu provincia, en movimiento.",
  h1: "Crea tu cuenta",
  title: "Coches en tu provincia",
  titleSm: "Ana",
  heading: "Paradas y horarios estimados",
  subtitle: "Indica cómo quieres usar MVC.",
  lead: "Recibir código",
  body: "Comparte coche para tus trayectos habituales.",
  bodyStrong: "Tu reserva confirmada",
  rowTitle: "Montequinto",
  rowText: "Tú te subes aquí",
  rowTextStrong: "Desvío aprox. 5 min",
  label: "Nombre",
  caption: "Matrícula ilustrativa: 1234 LKM",
  captionStrong: "Datos ilustrativos",
  tabLabel: "Publicar",
  navLabel: "Mensajes",
  button: "Crear cuenta",
  buttonSm: "Ver viaje",
  buttonXs: "Ver todos",
  kpi: "48,00 €",
  kpiLg: "07:25",
  code: "4821",
};

export function TypographySection(): React.JSX.Element {
  const variants = Object.keys(typography) as TextVariant[];
  return (
    <View>
      {variants.map((variant) => {
        const spec = typography[variant];
        return (
          <Demo
            key={variant}
            title={`${variant} · ${spec.fontSize}/${spec.lineHeight} · ls ${spec.letterSpacing}`}
          >
            <Text variant={variant} color={variant === "display" ? "strong" : variant.startsWith("h") || variant === "title" ? "heading" : "body"}>
              {sampleText[variant] ?? variant}
            </Text>
          </Demo>
        );
      })}
    </View>
  );
}

export function IconsSection(): React.JSX.Element {
  return (
    <View>
      <Text variant="body" color="muted" style={styles.intro}>
        {`${iconNames.length} iconos semánticos (IconName). Usa siempre el nombre semántico, nunca el glifo de la librería.`}
      </Text>
      <View style={styles.iconGrid}>
        {iconNames.map((name) => (
          <View key={name} style={styles.iconCell} accessible accessibilityLabel={name}>
            <Icon name={name} size={30} color={colors.primary} />
            <Text variant="caption" color="muted" size={11} lineHeight={13} align="center" numberOfLines={1} style={styles.iconName}>
              {name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function LogoSection(): React.JSX.Element {
  return (
    <View>
      <Demo title="horizontal" note="Cabeceras de láminas">
        <MvcLogo variant="horizontal" width={260} />
      </Demo>
      <Demo title="stacked" note="Bienvenida (01)">
        <MvcLogo variant="stacked" width={200} />
      </Demo>
      <Demo title="icon" note="Icono de la app, avatar de la plataforma («MVC» en 28)">
        <Wrap gap={20}>
          <MvcLogo variant="icon" width={96} />
          <MvcLogo variant="icon" width={48} />
          <MvcLogo variant="icon" width={28} />
        </Wrap>
      </Demo>
      <Demo title="monochrome" note="Sobre fondo azul">
        <View style={styles.logoOnBlue}>
          <MvcLogo variant="horizontal" width={240} monochrome={colors.onPrimary} />
        </View>
      </Demo>
    </View>
  );
}

export function ArtSection(): React.JSX.Element {
  const groups = Object.entries(images) as Array<[string, Record<string, ImageAsset>]>;
  return (
    <View>
      <Text variant="body" color="muted" style={styles.intro}>
        Recortes ILUSTRATIVOS de baja resolución de las láminas aprobadas (personas y vehículos generados). Sirven para la vista
        previa; los originales los aporta la propiedad (ver docs/DESIGN_SYSTEM.md).
      </Text>
      {groups.map(([group, items]) => (
        <Group key={group} title={group}>
          <Wrap gap={14}>
            {Object.entries(items).map(([key, asset]) => {
              const width = Math.min(150, asset.width);
              return (
                <View key={key} style={styles.artCell}>
                  <Image
                    source={asset.source}
                    style={[styles.art, { width, height: Math.round((asset.height * width) / asset.width) }]}
                    resizeMode="contain"
                    accessibilityLabel={`${group}.${key}`}
                  />
                  <Text variant="caption" color="muted" size={11.5} lineHeight={14}>
                    {`${key} · ${asset.width}×${asset.height}`}
                  </Text>
                </View>
              );
            })}
          </Wrap>
        </Group>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: 8 },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 14 },
  iconCell: { width: "25%", alignItems: "center", paddingVertical: 10 },
  iconName: { marginTop: 4, width: "100%" },
  logoOnBlue: { backgroundColor: colors.primary, borderRadius: 14, padding: 20, alignItems: "center" },
  artCell: { alignItems: "flex-start" },
  art: { backgroundColor: colors.bg.tint, borderRadius: 8, marginBottom: 4 },
});
