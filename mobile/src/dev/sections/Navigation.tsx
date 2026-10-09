import React, { useState } from "react";
import { View } from "react-native";
import { images } from "@/assets";
import {
  Avatar,
  BottomNav,
  Button,
  ChatBubble,
  ChatLocationCard,
  MessageComposer,
  ScreenHeader,
  Text,
  type BottomNavKey,
} from "@/ui";
import { colors } from "@/theme";
import { Demo, Group } from "../GalleryParts";

export function HeadersSection(): React.JSX.Element {
  const [tab, setTab] = useState<BottomNavKey>("map");
  const [withBadge, setWithBadge] = useState(true);
  return (
    <View>
      <Text variant="body" color="muted" style={{ marginTop: 8 }}>
        La cabecera lleva el chevron azul de «atrás» y el título centrado. Sin navegador, «atrás» no hace nada visible.
      </Text>
      <Group title="ScreenHeader">
        <Demo title="default (12 «Detalle del viaje»)">
          <ScreenHeader title="Detalle del viaje" onBack={() => undefined} />
        </Demo>
        <Demo title="rightAction (31 «Editar»)">
          <ScreenHeader title="Mis destinos" onBack={() => undefined} rightAction={{ label: "Editar", onPress: () => undefined }} />
        </Demo>
        <Demo title="onMenu (26 «Chat de reserva»)">
          <ScreenHeader title="Chat de reserva" onBack={() => undefined} onMenu={() => undefined} />
        </Demo>
        <Demo title="rightAvatar y subtítulo (37)">
          <ScreenHeader title="Resumen" subtitle="Panel de administración" hideBack rightAvatar={{ initials: "A", onPress: () => undefined }} />
        </Demo>
        <Demo title="hideBack (09 «Coches en tu provincia»)">
          <ScreenHeader title="Coches en tu provincia" hideBack />
        </Demo>
        <Demo title="large (03 «Crea tu cuenta»)">
          <ScreenHeader variant="large" title="Crea tu cuenta" subtitle="Usa tu móvil para entrar de forma segura." onBack={() => undefined} />
        </Demo>
      </Group>
      <Group title="BottomNav (09)">
        <Demo title="activa: Mapa" note="safeArea desactivado en la galería">
          <BottomNav active={tab} onNavigate={setTab} badges={withBadge ? { messages: 2 } : undefined} safeArea={false} />
        </Demo>
        <Demo title="controles">
          <Button label={withBadge ? "Quitar contador de Mensajes" : "Poner contador en Mensajes"} variant="tint" size="sm" chevron={false} onPress={() => setWithBadge((v) => !v)} />
        </Demo>
      </Group>
    </View>
  );
}

export function ChatSection(): React.JSX.Element {
  const [draft, setDraft] = useState("");
  return (
    <View>
      <Group title="ChatBubble (26)">
        <Demo title="recibido, con foto">
          <ChatBubble
            side="incoming"
            text="Hola Miguel, salgo en 5 min. Nos vemos en el aparcamiento P1 de Isla Mágica, junto a la entrada principal."
            time="07:18"
            avatar={<Avatar source={images.avatars.ana.source} name="Ana García" size="sm" />}
          />
        </Demo>
        <Demo title="enviado · leído">
          <ChatBubble side="outgoing" text="Genial, ahí estaré. Te adjunto mi ubicación exacta." time="07:20" status="read" />
        </Demo>
        <Demo title="enviado · entregado / enviado / enviando">
          <ChatBubble side="outgoing" text="Entregado" time="07:21" status="delivered" />
          <View style={{ height: 8 }} />
          <ChatBubble side="outgoing" text="Enviado" time="07:21" status="sent" />
          <View style={{ height: 8 }} />
          <ChatBubble side="outgoing" text="Enviando…" time="07:22" status="pending" />
        </Demo>
        <Demo title="error de envío">
          <ChatBubble side="outgoing" text="No ha salido" time="07:22" status="failed" onRetry={() => undefined} />
        </Demo>
      </Group>
      <Group title="ChatLocationCard">
        <ChatLocationCard title="Aparcamiento P1" lines={["Isla Mágica", "Sevilla"]} time="07:20" status="read" onPress={() => undefined} />
      </Group>
      <Group title="MessageComposer">
        <Demo title="vacío (micrófono) / con texto (enviar)" note="Escribe para ver el botón de enviar">
          <MessageComposer value={draft} onChangeText={setDraft} onSend={() => setDraft("")} onAttach={() => undefined} onDictate={() => undefined} onVoice={() => undefined} />
        </Demo>
        <Demo title="sin micrófonos">
          <MessageComposer value={draft} onChangeText={setDraft} onSend={() => setDraft("")} />
        </Demo>
      </Group>
      <View style={{ height: 8, backgroundColor: colors.bg.screen }} />
    </View>
  );
}
