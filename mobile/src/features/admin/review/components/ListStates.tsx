/**
 * Piezas de estado de las listas del panel: esqueleto de tarjetas, «Cargar más», franja de «no se ha podido actualizar»
 * y la nota fija de acceso a documentación privada.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Button, OfflineBanner, Skeleton, Spinner, Text } from "@/ui";
import { reviewStrings } from "../strings";

/** Tres tarjetas de carga con la silueta de una tarjeta de cola (avatar, dos líneas, filas y botones). */
export function CardListSkeleton({ count = 2, testID = "ListSkeleton" }: { count?: number; testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={reviewStrings.common.loading} accessibilityState={{ busy: true }}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.skeletonCard, index > 0 ? styles.cardGap : null]}>
          <View style={styles.skeletonHead}>
            <Skeleton circle height={64} width={64} />
            <View style={styles.skeletonHeadText}>
              <Skeleton height={20} width="55%" />
              <Skeleton height={26} width="40%" radius={13} style={styles.line} />
            </View>
          </View>
          <Skeleton height={16} width="70%" style={styles.line} />
          <Skeleton height={16} width="60%" style={styles.line} />
          <Skeleton height={42} radius={14} style={styles.lineLg} />
        </View>
      ))}
    </View>
  );
}

export interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  /** Falló la última página: se avisa y se deja reintentar. */
  failed: boolean;
  onPress: () => void;
  testID?: string;
}

/** Cierre de la lista: «Cargar más», progreso o el aviso de que no se ha podido cargar más. */
export function LoadMore({ hasMore, loading, failed, onPress, testID = "LoadMore" }: LoadMoreProps): React.JSX.Element | null {
  if (loading) {
    return (
      <View testID={`${testID}.loading`} style={styles.more} accessible accessibilityLabel={reviewStrings.common.loadingMore} accessibilityState={{ busy: true }}>
        <Spinner />
      </View>
    );
  }
  if (failed) {
    return (
      <View testID={`${testID}.error`} style={styles.more}>
        <Text variant="rowText" color="error" align="center" style={styles.moreText}>
          {reviewStrings.common.loadMoreError}
        </Text>
        <Button label={reviewStrings.common.retry} variant="outline" size="sm" inline chevron={false} onPress={onPress} testID={`${testID}.retry`} />
      </View>
    );
  }
  if (!hasMore) return null;
  return (
    <View style={styles.more}>
      <Button label={reviewStrings.common.loadMore} variant="tint" size="sm" inline chevron={false} onPress={onPress} testID={`${testID}.button`} />
    </View>
  );
}

/** «Mostramos lo último que tenías cargado»: hay datos, pero la última actualización falló. */
export function RefreshFailedStrip({ offline, onRetry, testID = "RefreshFailed" }: { offline: boolean; onRetry: () => void; testID?: string }): React.JSX.Element {
  return (
    <OfflineBanner
      testID={testID}
      title={offline ? reviewStrings.common.offlineTitle : reviewStrings.common.loadErrorTitle}
      detail={offline ? reviewStrings.common.offlineDetail : undefined}
      retryLabel={reviewStrings.common.retry}
      onRetry={onRetry}
      style={styles.strip}
    />
  );
}

/**
 * Nota fija al pie de 38: «Acceso a documentación privada solo para personal autorizado de MVC.» con el candado en un
 * disco azul claro (38a: tarjeta de 54 pt, disco de 39 pt, texto de 15,5 pt en azul).
 */
export function PrivateAccessNote({ text = reviewStrings.users.accessNote, testID = "PrivateAccessNote" }: { text?: string; testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={text} style={styles.note}>
      <View style={styles.noteDisc}>
        <Icon name="lock" size={22} color={colors.primary} />
      </View>
      <Text variant="body" color={colors.text.deep} size={15.5} lineHeight={21} letterSpacing={-0.15} style={styles.noteText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border.soft,
    backgroundColor: colors.bg.white,
    padding: 15,
  },
  cardGap: { marginTop: 8 },
  skeletonHead: { flexDirection: "row", alignItems: "center" },
  skeletonHeadText: { flex: 1, marginLeft: 14 },
  line: { marginTop: 10 },
  lineLg: { marginTop: 16 },
  more: { alignItems: "center", paddingVertical: 14 },
  moreText: { marginBottom: 8 },
  strip: { marginBottom: 8 },
  note: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.info.bg,
    borderRadius: 16,
    paddingVertical: 8,
    paddingLeft: 15,
    paddingRight: 14,
  },
  noteDisc: { width: 39, height: 39, borderRadius: 19.5, backgroundColor: colors.bg.tintStrong, alignItems: "center", justifyContent: "center" },
  noteText: { flex: 1, marginLeft: 11 },
});
