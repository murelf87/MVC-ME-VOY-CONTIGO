import React, { useState } from "react";
import { View } from "react-native";
import { images } from "@/assets";
import { IconTile } from "@/icons";
import {
  Avatar,
  Banner,
  Card,
  CountBadge,
  Divider,
  EmptyState,
  ErrorStateCard,
  KeyValueRow,
  ListRow,
  LoadingBlock,
  MapCard,
  NumberedList,
  OfflineBanner,
  RatingBadge,
  RatingStars,
  RouteTimeline,
  SectionHeader,
  Skeleton,
  SkeletonList,
  SkeletonText,
  Spinner,
  StatTile,
  StatusPill,
  StepProgress,
  Switch,
  Text,
  type BannerKind,
  type StatusTone,
  type SurfaceTone,
} from "@/ui";
import { Demo, Group, Spacer, Wrap } from "../GalleryParts";

const tones: readonly SurfaceTone[] = ["white", "blue", "blueStrong", "green", "amber", "orange", "red", "gray"];

export function CardsSection(): React.JSX.Element {
  const [essential, setEssential] = useState(true);
  return (
    <View>
      <Group title="Card / TintCard">
        {tones.map((tone) => (
          <Demo key={tone} title={`tone="${tone}"`}>
            <Card tone={tone}>
              <Text variant="rowTitle" color="heading">
                Precio por persona
              </Text>
              <Text variant="body" color="body">
                Propuesta: 3,50 €
              </Text>
            </Card>
          </Demo>
        ))}
        <Demo title="pulsable">
          <Card onPress={() => undefined} accessibilityLabel="Tarjeta pulsable">
            <Text variant="rowTitle" color="heading">
              Tarjeta pulsable
            </Text>
          </Card>
        </Demo>
      </Group>
      <Group title="ListRow">
        <Demo title="con icono y chevron (29)">
          <ListRow title="Editar perfil" subtitle="Foto, nombre y preferencias" leading={<IconTile name="personOutline" size={48} />} onPress={() => undefined} />
        </Demo>
        <Demo title="con foto (27)">
          <ListRow
            title="Tu recogida en 5 min"
            subtitle="Ana está de camino. Llegará sobre las 07:25 al aparcamiento P1."
            leading={<Avatar source={images.avatars.ana.source} name="Ana García" size="md" />}
            value="07:20"
            onPress={() => undefined}
          />
        </Demo>
        <Demo title="con interruptor (18/34)">
          <ListRow
            title="Avisos esenciales del viaje"
            subtitle="Cambios de hora, recogida, aceptaciones, cancelaciones."
            leading={<IconTile name="car" size={48} tone="white" />}
            trailing={<Switch value={essential} onValueChange={setEssential} accessibilityLabel="Avisos esenciales del viaje" />}
          />
        </Demo>
        <Demo title="valor «Por definir» (34)">
          <ListRow title="Comisión de la plataforma" value="Por definir" leading={<IconTile name="help" size={40} tone="solidBlue" />} onPress={() => undefined} />
        </Demo>
        <Demo title="destructiva (34)">
          <ListRow title="Eliminar cuenta" subtitle="Borra tu cuenta y tus datos" leading={<IconTile name="trash" tone="red" size={48} />} destructive onPress={() => undefined} />
        </Demo>
        <Demo title="desactivada, tono gris">
          <ListRow title="Próximamente" subtitle="No disponible" tone="gray" disabled />
        </Demo>
      </Group>
      <Group title="SectionHeader">
        <Demo title="con enlace (34b «Últimos cobros / Ver todos»)">
          <SectionHeader title="Últimos cobros" actionLabel="Ver todos" onAction={() => undefined} />
        </Demo>
        <Demo title="con píldora (31 «Mis destinos / + Añadir»)">
          <SectionHeader title="Mis destinos" level="title" actionLabel="Añadir" actionIcon="add" actionStyle="pill" onAction={() => undefined} />
        </Demo>
      </Group>
      <Group title="KeyValueRow (15/16)">
        <Demo title="desglose">
          <KeyValueRow label="Aporte del viaje" value="4,00 €" caption="Ejemplo orientativo (6 km)" tag="ilustrativo" />
          <KeyValueRow label="Gestión MVC" value="Por definir" onHelp={() => undefined} />
          <KeyValueRow label="Total" value="Por definir" emphasis />
        </Demo>
      </Group>
      <Group title="StatTile (37)">
        <Demo title="KPI">
          <Wrap gap={10}>
            <StatTile icon="car" value="42" label="Viajes activos" trend={{ direction: "up", text: "+12%" }} caption="Datos ilustrativos" style={{ width: "48%" }} />
            <StatTile icon="warning" iconTone="orange" value="3" label="Incidencias" trend={{ direction: "down", text: "−2" }} style={{ width: "48%" }} />
          </Wrap>
        </Demo>
      </Group>
      <Group title="Divider">
        <Demo title="con etiqueta (04)">
          <Divider label="o" />
        </Demo>
      </Group>
    </View>
  );
}

const bannerKinds: readonly BannerKind[] = ["info", "success", "warning", "error", "notice"];
const pillTones: readonly StatusTone[] = ["blue", "green", "amber", "orange", "red", "gray"];

export function FeedbackSection(): React.JSX.Element {
  return (
    <View>
      <Group title="Banner · md">
        {bannerKinds.map((kind) => (
          <Demo key={kind} title={kind}>
            <Banner kind={kind} title="Título del aviso" message="Texto explicativo en una o dos líneas para el usuario." />
          </Demo>
        ))}
      </Group>
      <Group title="Banner · tamaños medidos (04, 16b, 22)">
        <Demo title="xs · 22 «El cambio de ruta…»">
          <Banner kind="info" size="xs" tileTone="slate" message="El cambio de ruta se aplicará solo si lo aceptas." />
        </Demo>
        <Demo title="sm · 04 «Código incorrecto»">
          <Banner kind="error" size="sm" message="Código incorrecto: inténtalo de nuevo." />
        </Demo>
        <Demo title="md · 22 «Ana propone una nueva parada»">
          <Banner kind="warning" size="md" title="Ana propone una nueva parada" message="Quiere recoger a otro pasajero en su ruta." />
        </Demo>
        <Demo title="lg · 16b «¡Solicitud aceptada!»">
          <Banner kind="success" size="lg" title="¡Solicitud aceptada!" message="Ana ha aceptado tu solicitud." />
        </Demo>
        <Demo title="md + ajustes · 16b «Si la solicitud es rechazada»">
          <Banner kind="error" tileSize={34} titleSize={16} messageSize={14} icon="close" chevron onPress={() => undefined} title="Si la solicitud es rechazada" message="Te avisaremos y no se realizará ningún cobro." style={{ minHeight: 74 }} />
        </Demo>
        <Demo title="error con acción">
          <Banner kind="error" title="No hemos podido enviar el código" message="Inténtalo de nuevo en unos minutos." actionLabel="Reintentar" onAction={() => undefined} />
        </Demo>
        <Demo title="pulsable con chevron">
          <Banner kind="info" title="Importes ilustrativos" message="No son tarifas finales." chevron onPress={() => undefined} />
        </Demo>
      </Group>
      <Group title="OfflineBanner (22)">
        <Demo title="sin señal">
          <OfflineBanner title="Sin señal" detail="Última posición: hace 2 min" icon="signal" onInfo={() => undefined} />
        </Demo>
        <Demo title="sin conexión con reintento">
          <OfflineBanner retryLabel="Reintentar" onRetry={() => undefined} />
        </Demo>
      </Group>
      <Group title="StatusPill">
        <Demo title="tonos (md)">
          <Wrap>
            {pillTones.map((tone) => (
              <StatusPill key={tone} label={tone === "green" ? "Cobrado" : tone === "amber" ? "Propuesta" : tone === "red" ? "Rechazada" : tone === "orange" ? "Pendiente" : tone === "gray" ? "Caducada" : "En revisión"} tone={tone} />
            ))}
          </Wrap>
        </Demo>
        <Demo title="con icono, sm y contorno">
          <Wrap>
            <StatusPill label="En 12 min" tone="green" icon="check" />
            <StatusPill label="Verificado" tone="green" size="sm" icon="checkCircle" />
            <StatusPill label="Propuesta" tone="blue" outlined />
          </Wrap>
        </Demo>
      </Group>
      <Group title="ErrorStateCard (36a)">
        <Demo title="No hay plazas">
          <ErrorStateCard kind="noSeats" onAction={() => undefined} />
        </Demo>
        <Demo title="Destino fuera de provincia">
          <ErrorStateCard kind="outOfProvince" onAction={() => undefined} />
        </Demo>
        <Demo title="Pago rechazado">
          <ErrorStateCard kind="paymentRejected" onAction={() => undefined} />
        </Demo>
        <Demo title="Sin señal GPS">
          <ErrorStateCard kind="gpsOff" onAction={() => undefined} />
        </Demo>
      </Group>
      <Group title="EmptyState (25)">
        <Demo title="tarjeta">
          <EmptyState title="Aún no tienes más mensajes" message="Cuando reserves o te escriban, aparecerán aquí." />
        </Demo>
        <Demo title="a pantalla completa, con acción">
          <EmptyState variant="plain" icon="search" title="Sin coincidencias" message="Prueba a ampliar el horario o más días." actionLabel="Cambiar búsqueda" onAction={() => undefined} />
        </Demo>
      </Group>
      <Group title="CountBadge">
        <Demo title="tamaños y tonos">
          <Wrap gap={14}>
            <CountBadge count={2} />
            <CountBadge count={3} tone="primary" />
            <CountBadge count={120} />
            <CountBadge count={5} size="sm" />
            <CountBadge count={1} dot size="md" />
          </Wrap>
        </Demo>
      </Group>
    </View>
  );
}

export function ProgressSection(): React.JSX.Element {
  const [stars, setStars] = useState(4);
  const steps = ["Solicitud", "Aceptada", "Pago", "Confirmada"];
  return (
    <View>
      <Group title="StepProgress (16)">
        {[0, 1, 2, 3].map((current) => (
          <Demo key={current} title={`paso actual ${current + 1}`}>
            <StepProgress steps={steps} current={current} />
          </Demo>
        ))}
      </Group>
      <Group title="Valoración">
        <Demo title="RatingStars interactivas (24)">
          <RatingStars value={stars} onChange={setStars} />
        </Demo>
        <Demo title="RatingBadge">
          <Wrap gap={18}>
            <RatingBadge average={4.8} count={32} />
            <RatingBadge average={4.8} count={32} withLabel />
            <RatingBadge average={null} count={0} />
          </Wrap>
        </Demo>
      </Group>
      <Group title="NumberedList (06)">
        <NumberedList items={["Busca un lugar con buena luz", "Sitúa tu rostro dentro del marco", "Mantén la mirada al frente", "Pulsa para iniciar la captura"]} />
      </Group>
      <Group title="Carga">
        <Demo title="SkeletonList · row">
          <SkeletonList count={2} />
        </Demo>
        <Demo title="SkeletonList · card">
          <SkeletonList count={1} variant="card" />
        </Demo>
        <Demo title="SkeletonText y Skeleton">
          <SkeletonText lines={3} />
          <Spacer />
          <Skeleton height={48} radius={14} />
        </Demo>
        <Demo title="Spinner y LoadingBlock">
          <Wrap gap={20}>
            <Spinner />
            <Spinner size="sm" />
          </Wrap>
          <LoadingBlock label="Buscando coches cerca de ti…" />
        </Demo>
      </Group>
    </View>
  );
}

export function PeopleSection(): React.JSX.Element {
  return (
    <View>
      <Group title="Avatar">
        <Demo title="tamaños (xs 28 · sm 36 · md 45 · lg 62 · xl 75 · xxl 90 · hero 112)">
          <Wrap gap={12}>
            {(["sm", "md", "lg", "xl", "xxl", "hero"] as const).map((size) => (
              <Avatar key={size} source={images.avatars.ana.source} name="Ana García" size={size} />
            ))}
          </Wrap>
        </Demo>
        <Demo title="sin foto (iniciales)">
          <Wrap gap={12}>
            <Avatar name="Ana García" size="lg" />
            <Avatar name="Miguel Torres" size="lg" />
            <Avatar name="A" size="md" />
          </Wrap>
        </Demo>
        <Demo title="insignias y desenfoque (05, 07)">
          <Wrap gap={18}>
            <Avatar source={images.profile.photo.source} name="Tu foto" size="hero" ring badge="camera" onBadgePress={() => undefined} badgeAccessibilityLabel="Cambiar foto" />
            <Avatar source={images.avatars.miguel.source} name="Miguel" size="xl" verified />
            <Avatar source={images.profile.photo.source} name="Comprobación privada" size="xl" blurred badge="lock" />
          </Wrap>
        </Demo>
      </Group>
      <Group title="RouteTimeline">
        <Demo title="table (12 «Paradas y horarios estimados»)">
          <RouteTimeline
            stops={[
              { title: "Montequinto", time: "08:05", note: "Tú te subes aquí", state: "current" },
              { title: "Dos Hermanas", titleSuffix: "(opcional)", time: "08:15", note: "Desvío aprox. 5 min", state: "optional" },
              { title: "Sevilla – Universidad", time: "08:28", note: "Llegada al destino", state: "destination" },
            ]}
          />
        </Demo>
        <Demo title="compact (23/30)">
          <RouteTimeline
            variant="compact"
            stops={[
              { title: "Aparcamiento P1 · Isla Mágica", time: "07:25", state: "done" },
              { title: "Sevilla Centro", time: "07:45", state: "destination" },
            ]}
          />
        </Demo>
      </Group>
      <Group title="MapCard">
        <Demo title="listo (el mapa lo dibuja src/maps)">
          <MapCard height={150}>
            <View style={{ flex: 1, backgroundColor: "#E9F1E4", alignItems: "center", justifyContent: "center" }}>
              <Text variant="rowText" color="muted">
                Aquí va el mapa
              </Text>
            </View>
          </MapCard>
        </Demo>
        <Demo title="cargando">
          <MapCard height={120} status="loading" />
        </Demo>
        <Demo title="no disponible">
          <MapCard height={200} status="unavailable" onRetry={() => undefined} />
        </Demo>
      </Group>
    </View>
  );
}
