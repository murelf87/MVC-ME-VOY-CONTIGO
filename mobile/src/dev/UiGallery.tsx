/**
 * Galería del sistema de diseño de MVC · Me voy contigo.
 *
 * Solo existe en desarrollo y en la vista previa: `navigation/devRoutes.tsx` la importa dentro de una rama
 * `__DEV__ || EXPO_PUBLIC_PREVIEW === "1"` que Metro elimina del paquete de producción.
 *
 * Muestra cada componente del kit (`@/ui`, `@/icons`, `@/brand`) en los estados de las láminas aprobadas, con datos de
 * ejemplo de la propia galería (nunca de la API). En web puede abrirse una sección concreta con `#botones`, `#campos`…
 */
import React, { useState } from "react";
import { Platform, View } from "react-native";
import { Screen, ScreenHeader, Segmented, ToastHost } from "@/ui";
import { ArtSection, ColorsSection, IconsSection, LogoSection, TypographySection } from "./sections/Foundations";
import { ButtonsSection, ControlsSection, FieldsSection } from "./sections/Inputs";
import { ChatSection, HeadersSection } from "./sections/Navigation";
import { OverlaysSection } from "./sections/Overlays";
import { CardsSection, FeedbackSection, PeopleSection, ProgressSection } from "./sections/Surfaces";

interface GallerySection {
  key: string;
  label: string;
  render: () => React.JSX.Element;
}

const sections: readonly GallerySection[] = [
  { key: "colores", label: "Colores", render: ColorsSection },
  { key: "texto", label: "Texto", render: TypographySection },
  { key: "iconos", label: "Iconos", render: IconsSection },
  { key: "logo", label: "Logo", render: LogoSection },
  { key: "arte", label: "Arte", render: ArtSection },
  { key: "botones", label: "Botones", render: ButtonsSection },
  { key: "campos", label: "Campos", render: FieldsSection },
  { key: "controles", label: "Controles", render: ControlsSection },
  { key: "tarjetas", label: "Tarjetas", render: CardsSection },
  { key: "avisos", label: "Avisos", render: FeedbackSection },
  { key: "progreso", label: "Progreso", render: ProgressSection },
  { key: "personas", label: "Personas", render: PeopleSection },
  { key: "cabeceras", label: "Cabeceras", render: HeadersSection },
  { key: "chat", label: "Chat", render: ChatSection },
  { key: "capas", label: "Capas", render: OverlaysSection },
];

function initialSection(): string {
  const first = sections[0]?.key ?? "colores";
  if (Platform.OS !== "web" || typeof window === "undefined") return first;
  const hash = window.location.hash.replace(/^#/, "");
  return sections.some((section) => section.key === hash) ? hash : first;
}

export function UiGallery(): React.JSX.Element {
  const [active, setActive] = useState<string>(initialSection);
  const section = sections.find((s) => s.key === active) ?? sections[0];
  const Body = section?.render;
  return (
    <Screen
      testID="UiGallery"
      header={<ScreenHeader title="Sistema de diseño" subtitle="MVC · Me voy contigo" onBack={() => undefined} hideBack />}
    >
      <Segmented
        variant="pills"
        scrollable
        value={active}
        onChange={setActive}
        options={sections.map((s) => ({ value: s.key, label: s.label, testID: `UiGallery.section.${s.key}` }))}
        accessibilityLabel="Sección de la galería"
      />
      <View testID={`UiGallery.body.${active}`} style={{ paddingBottom: 48 }}>
        {Body !== undefined ? <Body /> : null}
      </View>
      <ToastHost />
    </Screen>
  );
}

export default UiGallery;
