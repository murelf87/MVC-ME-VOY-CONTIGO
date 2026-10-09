import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { describeError } from "@/api";
import { colors, radii, shadows } from "@/theme";
import { Button, EmptyState, ErrorStateCard, Spinner, Text } from "@/ui";
import type { MapNotice, MapOverlay } from "../logic/mapView";
import { browseStrings } from "../strings";
import { MapAlert } from "./MapAlert";

const copy = browseStrings.mapHome;

export interface MapPillProps {
  label: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Píldora de «Buscando…» sobre el mapa: indicador de progreso + texto, anunciada como región viva. */
export function MapPill({ label, testID, style }: MapPillProps): React.JSX.Element {
  return (
    <View style={[styles.pillWrap, style]}>
      <View testID={testID} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityLiveRegion="polite" style={styles.pill}>
        <Spinner size="sm" accessibilityLabel={label} />
        <Text variant="rowTextStrong" color="heading" size={15} style={styles.pillText}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export interface MapOverlayViewProps {
  overlay: MapOverlay;
  onRetryProvinces: () => void;
  onRetryCars: () => void;
  onDefineRoute: () => void;
  onClearFilters: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Lo que el mapa cuenta cuando NO se pueden enseñar coches: cargando, sin provincias, error, sin conexión o vacío. Cada
 * estado tiene su salida («Reintentar», «Definir mi recorrido», «Quitar filtros»); el mapa sigue visible debajo.
 */
export function MapOverlayView({ overlay, onRetryProvinces, onRetryCars, onDefineRoute, onClearFilters, style }: MapOverlayViewProps): React.JSX.Element | null {
  switch (overlay.kind) {
    case "none":
      return null;
    case "loading":
      return <MapPill label={copy.loadingCars} testID="MapHome.loading" style={style} />;
    case "provincesError":
      return (
        <ErrorStateCard
          testID="MapHome.provincesError"
          tone={overlay.offline ? "amber" : "red"}
          icon={overlay.offline ? "offline" : "exclaim"}
          iconTone={overlay.offline ? "solidAmber" : "solidRed"}
          title={overlay.offline ? copy.offlineTitle : copy.provincesErrorTitle}
          message={copy.provincesErrorMessage}
          actionLabel={copy.retry}
          onAction={onRetryProvinces}
          style={style}
        />
      );
    case "noProvinces":
      return (
        <EmptyState
          testID="MapHome.noProvinces"
          icon="pin"
          title={copy.noProvinceTitle}
          message={copy.noProvinceMessage}
          actionLabel={copy.retry}
          onAction={onRetryProvinces}
          style={style}
        />
      );
    case "carsError": {
      const described = describeError(overlay.error);
      return (
        <ErrorStateCard
          testID="MapHome.carsError"
          tone="red"
          icon="exclaim"
          iconTone="solidRed"
          title={copy.carsErrorTitle}
          message={described.kind === "api" ? described.message : copy.carsErrorMessage}
          actionLabel={copy.retry}
          onAction={onRetryCars}
          style={style}
        />
      );
    }
    case "carsOffline":
      return (
        <ErrorStateCard
          testID="MapHome.carsOffline"
          tone="amber"
          icon="offline"
          iconTone="solidAmber"
          title={copy.offlineTitle}
          message={copy.carsOfflineMessage}
          actionLabel={copy.retry}
          onAction={onRetryCars}
          style={style}
        />
      );
    case "empty":
      return (
        <EmptyState
          testID="MapHome.empty"
          icon="car"
          title={overlay.filtered ? copy.emptyFilteredTitle : copy.emptyTitle}
          message={overlay.filtered ? copy.emptyFilteredMessage : copy.emptyMessage}
          actionLabel={copy.emptyDefineRoute}
          onAction={onDefineRoute}
          style={style}
        >
          {overlay.filtered ? (
            <Button
              label={copy.filterReset}
              variant="tint"
              size="sm"
              inline
              chevron={false}
              onPress={onClearFilters}
              style={styles.clear}
              testID="MapHome.empty.clearFilters"
            />
          ) : null}
        </EmptyState>
      );
  }
}

export interface MapNoticeViewProps {
  notice: MapNotice;
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Aviso sobre los coches que SÍ se ven: datos de antes sin conexión, actualización fallida o lista recortada. */
export function MapNoticeView({ notice, onRetry, style }: MapNoticeViewProps): React.JSX.Element | null {
  switch (notice.kind) {
    case "none":
      return null;
    case "offlineCached":
      return (
        <MapAlert
          tone="notice"
          icon="offline"
          title={copy.offlineTitle}
          message={copy.offlineDetail}
          actionLabel={copy.retry}
          onAction={onRetry}
          testID="MapHome.notice.offline"
          style={style}
        />
      );
    case "staleRefresh":
      return (
        <MapAlert
          tone="warning"
          icon="refresh"
          title={copy.staleTitle}
          message={copy.staleDetail}
          actionLabel={copy.retry}
          onAction={onRetry}
          testID="MapHome.notice.stale"
          style={style}
        />
      );
    case "truncated":
      return <MapAlert tone="info" icon="infoMark" title={copy.truncatedTitle} message={copy.truncatedMessage} testID="MapHome.notice.truncated" style={style} />;
  }
}

const styles = StyleSheet.create({
  pillWrap: { alignItems: "center", pointerEvents: "none" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.bg.white,
    boxShadow: shadows.float,
  },
  pillText: { marginLeft: 10 },
  clear: { marginTop: 14 },
});
