/**
 * 30 · Mis viajes. Pestañas «Próximos (2) · En curso (1) · Historial» y, debajo, las tarjetas del rol con el que se miran
 * los viajes (pasajero o conductor). Próximos separa las «Reservas semanales» del «Próximo viaje» y «Más viajes»; En curso
 * enseña el viaje que está en marcha; Historial se pagina por cursor.
 *
 * Datos: `GET /v1/me/trips/overview` (resumen y primera página del historial). Estados: cargando (esqueleto), error con
 * «Reintentar», sin conexión (se conserva lo cargado y se avisa), vacío por pestaña con su acción, y «Ver más» en el
 * historial. Cada tarjeta abre el detalle de la reserva, el viaje en directo o la consola del conductor según rol y estado;
 * el ⋮ ofrece retirar la solicitud pendiente, pagar, cancelar, seguir el viaje, etc. (todo con su confirmación).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { OverviewCard, Role } from "@/api/types";
import type { AppScreenProps } from "@/navigation/types";
import { selfServiceRoles, useAuth } from "@/session";
import { Button, ConfirmDialog, EmptyState, Screen, ScreenHeader, Segmented } from "@/ui";
import { CardMenuSheet } from "../components/CardMenuSheet";
import { ListSkeleton, LoadFailure, OfflineNotice } from "../components/ScreenStates";
import { SectionTitle } from "../components/SectionTitle";
import { TripCard } from "../components/TripCard";
import { TripTabs } from "../components/TripTabs";
import { useCardActions } from "../hooks/useCardActions";
import { useNow } from "../hooks/useNow";
import { overviewCardKey, useTripsHistory, useTripsOverview } from "../hooks/useTripsOverview";
import { useViewer } from "../hooks/useVerification";
import { hasBothRoles } from "../model/profileHeader";
import { buildTripCardView, splitUpcoming, tabFromParam, tabLabels, type CardAction, type TripCardView, type TripTab } from "../model/tripCards";
import { profileStrings } from "../strings";

const copy = profileStrings.myTrips;

const ROLE_OPTIONS = [
  { value: "passenger", label: copy.asPassenger, testID: "MyTrips.role.passenger" },
  { value: "driver", label: copy.asDriver, testID: "MyTrips.role.driver" },
] as const;

function pickRole(requested: Role | undefined, owned: readonly Role[], active: Role | null): Role {
  const allowed = (role: Role): boolean => owned.length === 0 || owned.includes(role);
  if (requested !== undefined && allowed(requested)) return requested;
  if (active !== null && allowed(active)) return active;
  return owned[0] ?? "passenger";
}

export function MyTripsScreen({ navigation, route }: AppScreenProps<"MyTrips">): React.JSX.Element {
  const { me, activeRole } = useAuth();
  const owned = React.useMemo<readonly Role[]>(() => (me === null ? [] : selfServiceRoles(me.roles)), [me]);
  const both = hasBothRoles(owned);
  const requestedRole = route.params?.role;
  const requestedTab = route.params?.tab;

  const [role, setRole] = React.useState<Role>(() => pickRole(requestedRole, owned, activeRole));
  const [tab, setTab] = React.useState<TripTab>(() => tabFromParam(requestedTab));
  const [menuView, setMenuView] = React.useState<TripCardView | null>(null);

  // Si la pantalla se reabre con otra pestaña o rol (aviso, enlace, «Ver mis reservas»), se respeta.
  React.useEffect(() => {
    setTab(tabFromParam(requestedTab));
  }, [requestedTab]);
  React.useEffect(() => {
    if (requestedRole !== undefined) setRole(requestedRole);
  }, [requestedRole]);
  // Si el rol elegido no pertenece a la cuenta (cuenta solo conductor, etc.), se pasa al que sí tiene.
  React.useEffect(() => {
    if (owned.length > 0 && !owned.includes(role)) setRole(owned[0] ?? "passenger");
  }, [owned, role]);

  const overview = useTripsOverview(role);
  const history = useTripsHistory(role, tab === "history");
  const viewer = useViewer();
  const now = useNow();
  const actions = useCardActions();

  const labels = React.useMemo(() => tabLabels(overview.data?.counts ?? null), [overview.data?.counts]);
  const build = React.useCallback((cards: readonly OverviewCard[]): TripCardView[] => cards.map((card) => buildTripCardView(card, { role, now, viewer })), [role, now, viewer]);

  const upcoming = React.useMemo(() => splitUpcoming(overview.data?.upcoming ?? []), [overview.data?.upcoming]);
  const weeklyViews = React.useMemo(() => build(upcoming.weekly), [build, upcoming.weekly]);
  const nextViews = React.useMemo(() => build(upcoming.next !== null ? [upcoming.next] : []), [build, upcoming.next]);
  const moreViews = React.useMemo(() => build(upcoming.more), [build, upcoming.more]);
  const inProgressViews = React.useMemo(() => build(overview.data?.inProgress ?? []), [build, overview.data?.inProgress]);
  const historyViews = React.useMemo(() => build(history.items), [build, history.items]);

  const refreshing = tab === "history" ? history.isRefreshing : overview.isRefreshing;
  const refresh = (): void => {
    void overview.refetch();
    if (tab === "history") void history.refresh();
  };

  const searchOrPublish = (): void => {
    if (role === "driver") navigation.navigate("PublishRoute");
    else navigation.navigate("MapHome");
  };

  // ── Cabecera fija: título, cambio de modo (solo si hay dos) y pestañas ──
  const header = (
    <View>
      <ScreenHeader title={copy.title} testID="MyTrips.nav" />
      {both ? (
        <Segmented
          variant="outline"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(next) => setRole(next)}
          accessibilityLabel={copy.roleSwitchLabel}
          testID="MyTrips.role"
          style={styles.roles}
        />
      ) : null}
      <TripTabs value={tab} labels={labels} onChange={setTab} style={styles.tabs} />
    </View>
  );

  // ── Cuerpo ──
  let body: React.ReactNode;
  const noData = overview.data === undefined;
  if (noData && overview.isLoading) {
    body = <ListSkeleton testID="MyTrips.loading" count={2} variant="card" />;
  } else if (noData && overview.isOffline) {
    body = (
      <View style={styles.state}>
        <OfflineNotice testID="MyTrips.offline" detail={copy.stale} onRetry={refresh} />
      </View>
    );
  } else if (noData && overview.isError) {
    body = <LoadFailure testID="MyTrips.error" title={copy.loadErrorTitle} error={overview.error} onRetry={refresh} />;
  } else if (tab === "upcoming") {
    body = (
      <UpcomingBody
        weekly={weeklyViews}
        next={nextViews}
        more={moreViews}
        role={role}
        onOpen={actions.run}
        onMenu={setMenuView}
        onEmptyAction={searchOrPublish}
      />
    );
  } else if (tab === "in_progress") {
    body =
      inProgressViews.length === 0 ? (
        <View style={styles.state}>
          <EmptyState testID="MyTrips.empty.in_progress" icon="car" title={copy.emptyInProgress.title} message={copy.emptyInProgress.message} />
        </View>
      ) : (
        <Section title={copy.inProgressHeading(inProgressViews.length)} first views={inProgressViews} prefix="MyTrips.inProgress" onOpen={actions.run} onMenu={setMenuView} />
      );
  } else if (history.isLoading) {
    body = <ListSkeleton testID="MyTrips.history.loading" count={2} variant="card" />;
  } else if (history.isError && history.items.length === 0) {
    body = <LoadFailure testID="MyTrips.history.error" title={copy.loadErrorTitle} error={history.error} onRetry={() => void history.refresh()} />;
  } else if (history.isEmpty) {
    body = (
      <View style={styles.state}>
        <EmptyState testID="MyTrips.empty.history" icon="clock" title={copy.emptyHistory.title} message={copy.emptyHistory.message} />
      </View>
    );
  } else {
    body = (
      <>
        <Section title={copy.historyHeading} first views={historyViews} prefix="MyTrips.history" onOpen={actions.run} onMenu={setMenuView} />
        {history.hasMore ? (
          <View style={styles.more}>
            {history.fetchMoreError !== null ? <EmptyState variant="plain" icon="alertCircle" title={copy.moreError} testID="MyTrips.history.moreError" /> : null}
            <Button
              testID="MyTrips.history.more"
              label={history.fetchMoreError !== null ? profileStrings.common.retry : profileStrings.common.loadMore}
              variant="outline"
              size="sm"
              inline
              loading={history.isFetchingMore}
              onPress={() => void history.fetchMore()}
            />
          </View>
        ) : null}
      </>
    );
  }

  const showOfflineNotice = !noData && (overview.isOffline || overview.failedToRefresh);

  return (
    <Screen testID="MyTrips" scroll padded={false} header={header} refreshing={refreshing} onRefresh={refresh} contentContainerStyle={styles.scroll}>
      {showOfflineNotice ? <OfflineNotice testID="MyTrips.stale" detail={overview.isOffline ? copy.stale : profileStrings.common.refreshFailed} onRetry={refresh} style={styles.notice} /> : null}
      {body}

      <CardMenuSheet view={menuView} onClose={() => setMenuView(null)} onSelect={actions.run} />
      <ConfirmDialog
        testID="MyTrips.withdrawDialog"
        visible={actions.withdrawDialog.visible}
        title={actions.withdrawDialog.title}
        message={actions.withdrawDialog.message}
        confirmLabel={actions.withdrawDialog.confirmLabel}
        cancelLabel={profileStrings.common.keep}
        destructive
        loading={actions.withdrawDialog.loading}
        onConfirm={actions.withdrawDialog.onConfirm}
        onCancel={actions.withdrawDialog.onCancel}
      />
    </Screen>
  );
}

// ── Piezas del cuerpo ─────────────────────────────────────────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  views: readonly TripCardView[];
  prefix: string;
  /** Primera sección de la lista: el título va 12 pt sobre la tarjeta (en las siguientes, 8,5 pt, como en la lámina). */
  first?: boolean;
  onOpen: (action: CardAction) => void;
  onMenu: (view: TripCardView) => void;
}

function Section({ title, views, prefix, first = false, onOpen, onMenu }: SectionProps): React.JSX.Element {
  return (
    <View style={first ? styles.sectionFirst : styles.sectionNext}>
      <SectionTitle title={title} size={24.4} style={[styles.sectionTitle, first ? styles.titleFirst : styles.titleNext]} testID={`${prefix}.heading`} />
      <View style={styles.cards}>
        {views.map((view, index) => (
          <TripCard key={view.key} view={view} testID={`${prefix}.card.${index}`} onOpen={onOpen} onMenu={onMenu} />
        ))}
      </View>
    </View>
  );
}

interface UpcomingBodyProps {
  weekly: readonly TripCardView[];
  next: readonly TripCardView[];
  more: readonly TripCardView[];
  role: Role;
  onOpen: SectionProps["onOpen"];
  onMenu: (view: TripCardView) => void;
  onEmptyAction: () => void;
}

function UpcomingBody({ weekly, next, more, role, onOpen, onMenu, onEmptyAction }: UpcomingBodyProps): React.JSX.Element {
  if (weekly.length === 0 && next.length === 0 && more.length === 0) {
    const driver = role === "driver";
    return (
      <View style={styles.state}>
        <EmptyState
          testID="MyTrips.empty.upcoming"
          icon={driver ? "car" : "calendar"}
          title={copy.emptyUpcoming.title}
          message={driver ? copy.emptyUpcoming.driverMessage : copy.emptyUpcoming.message}
          actionLabel={driver ? copy.emptyUpcoming.driverAction : copy.emptyUpcoming.action}
          onAction={onEmptyAction}
        />
      </View>
    );
  }
  let firstShown = false;
  const sections: React.ReactNode[] = [];
  const push = (key: string, title: string, views: readonly TripCardView[], prefix: string): void => {
    if (views.length === 0) return;
    sections.push(<Section key={key} title={title} views={views} prefix={prefix} first={!firstShown} onOpen={onOpen} onMenu={onMenu} />);
    firstShown = true;
  };
  push("weekly", role === "driver" ? copy.driverSeriesHeading(weekly.length) : copy.weeklyHeading(weekly.length), weekly, "MyTrips.weekly");
  push("next", copy.nextTripHeading, next, "MyTrips.next");
  push("more", copy.moreTripsHeading, more, "MyTrips.more");
  return <>{sections}</>;
}

const styles = StyleSheet.create({
  roles: { marginHorizontal: 13.5, marginTop: 4 },
  /** La barra llega a 13,5 pt del borde izquierdo y a 12,5 pt del derecho (lámina 30); empieza 5 pt bajo la cabecera. */
  tabs: { marginHorizontal: 13.5, marginTop: 5 },
  scroll: { paddingTop: 19, paddingBottom: 40 },
  notice: { marginHorizontal: 13.5, marginBottom: 12 },
  state: { marginHorizontal: 13.5, marginTop: 8 },
  sectionFirst: {},
  sectionNext: { marginTop: 18 },
  sectionTitle: { marginLeft: 25 },
  titleFirst: { marginBottom: 12 },
  titleNext: { marginBottom: 8.5 },
  cards: { rowGap: 14 },
  more: { alignItems: "center", marginTop: 16, rowGap: 8 },
});
