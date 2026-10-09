import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { images } from "@/assets";
import { Icon } from "@/icons";
import { IS_PREVIEW_BUILD } from "@/platform";
import { colors, hexAlpha, radii } from "@/theme";
import { Spinner, Text } from "@/ui";
import { useDocumentUrl } from "../hooks/useDocumentUrl";
import { vehicleName } from "../logic/vehicle";
import { publishStrings } from "../strings";
import type { VehicleRecord } from "../types";

const copy = publishStrings.vehicle;

export interface VehiclePhotoCardProps {
  vehicle: VehicleRecord;
  /** Foto recién elegida que se está subiendo: se enseña al momento, antes de que el servidor la devuelva. */
  localUri?: string | null;
  /** Texto de progreso de la subida («Subiendo la foto…»); `null` si no hay subida en curso. */
  busyLabel?: string | null;
  /** Abre la hoja para hacer o elegir una foto. */
  onChange: () => void;
  testID?: string;
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Ilustración empaquetada con la que la vista previa sustituye la foto subida (las URL firmadas de la simulación no se
 * pueden cargar en una imagen). SOLO en la compilación de vista previa y SOLO para el modelo exacto; en producción
 * se enseña siempre la foto del conductor.
 */
function previewIllustration(vehicle: VehicleRecord): { source: number } | null {
  if (!IS_PREVIEW_BUILD) return null;
  const make = fold(vehicle.make);
  const model = fold(vehicle.model);
  if (make === "seat" && model === "arona") return images.cars.seatArona;
  if (make === "seat" && model === "leon" && fold(vehicle.color ?? "") === "blanco") return images.cars.seatLeon;
  return null;
}

/**
 * Foto del vehículo de la lámina 17: tarjeta de 173 pt con la foto, el botón redondo de cámara en su esquina inferior
 * derecha y, debajo, la barra «Cambiar foto (opcional)». Sin foto muestra un marco punteado con un coche y «Añadir foto».
 * La foto es privada: se pide por URL firmada (`GET /v1/me/documents/:id/download`).
 */
export function VehiclePhotoCard({ vehicle, localUri = null, busyLabel = null, onChange, testID = "MyVehicle.photo" }: VehiclePhotoCardProps): React.JSX.Element {
  const documentId = vehicle.vehicle_photo_document_id ?? null;
  const hasPhoto = documentId !== null || localUri !== null;
  const illustration = localUri === null && hasPhoto ? previewIllustration(vehicle) : null;
  const remote = useDocumentUrl(illustration === null && localUri === null ? documentId : null);
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const remoteUrl = remote.data?.url ?? null;
  const uri = localUri ?? (remoteUrl !== null && remoteUrl !== failedUrl ? remoteUrl : null);
  const source = illustration !== null ? illustration.source : uri !== null ? { uri } : null;
  const loading = illustration === null && localUri === null && documentId !== null && remote.isLoading;
  const busy = busyLabel !== null;
  const status = vehicle.vehicle_photo_status;
  const name = vehicleName(vehicle);
  const barLabel = hasPhoto ? copy.photoChange : copy.photoAdd;

  return (
    <View testID={testID}>
      <View style={styles.frame}>
        {source !== null ? (
          <Image
            testID={`${testID}.image`}
            source={source}
            contentFit="cover"
            transition={0}
            accessibilityLabel={copy.photoA11y(name)}
            accessibilityIgnoresInvertColors
            onError={() => {
              if (remoteUrl !== null) setFailedUrl(remoteUrl);
            }}
            style={styles.image}
          />
        ) : (
          <View style={styles.empty} accessible accessibilityRole="image" accessibilityLabel={hasPhoto ? copy.photoA11y(name) : copy.photoEmpty}>
            {loading ? (
              <Spinner size="lg" />
            ) : (
              <>
                <Icon name="car" size={64} color={colors.gray.icon} />
                {!hasPhoto ? (
                  <>
                    <Text variant="rowTitle" color="muted" size={17} align="center" style={styles.emptyTitle}>
                      {copy.photoEmpty}
                    </Text>
                    <Text variant="rowText" color="muted" size={14.5} align="center" style={styles.emptyHint}>
                      {copy.photoEmptyHint}
                    </Text>
                  </>
                ) : null}
              </>
            )}
          </View>
        )}

        {!busy && hasPhoto && status === "pending" ? (
          <View style={[styles.chip, styles.chipReview]} testID={`${testID}.review`}>
            <Icon name="clock" size={16} color={colors.pill.amber.fg} />
            <Text variant="rowTextStrong" color={colors.pill.amber.fg} size={14} lineHeight={18} style={styles.chipText}>
              {copy.photoStatusReview}
            </Text>
          </View>
        ) : null}
        {!busy && hasPhoto && status === "rejected" ? (
          <View style={[styles.chip, styles.chipRejected]} testID={`${testID}.rejected`}>
            <Icon name="alertCircle" size={16} color={colors.error.text} />
            <Text variant="rowTextStrong" color={colors.error.text} size={14} lineHeight={18} style={styles.chipText}>
              {copy.photoStatusRejected}
            </Text>
          </View>
        ) : null}

        {busy ? (
          <View style={styles.busy} accessibilityLiveRegion="polite" testID={`${testID}.busy`}>
            <Spinner size="lg" color={colors.onPrimary} />
            <Text variant="bodyStrong" color="inverse" size={16} lineHeight={20} style={styles.busyText}>
              {busyLabel}
            </Text>
          </View>
        ) : null}

        <Pressable
          testID={`${testID}.camera`}
          accessibilityRole="button"
          accessibilityLabel={copy.photoCameraA11y}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={onChange}
          hitSlop={4}
          style={({ pressed }) => [styles.badge, pressed ? styles.badgePressed : null]}
        >
          <Icon name="camera" size={34} color={colors.primary} />
        </Pressable>
      </View>

      <Pressable
        testID={`${testID}.change`}
        accessibilityRole="button"
        accessibilityLabel={`${barLabel} ${copy.photoOptional}`}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={onChange}
        style={({ pressed }) => [styles.bar, pressed ? styles.barPressed : null]}
      >
        <Icon name="camera" size={26} color={colors.primary} />
        <Text variant="rowTitle" color="deep" size={19.5} lineHeight={24} letterSpacing={-0.3} style={styles.barText}>
          {barLabel}
          <Text variant="body" color="deep" size={19.5} lineHeight={24} letterSpacing={-0.3}>
            {` ${copy.photoOptional}`}
          </Text>
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 172.5,
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: "#E4E6E9",
  },
  image: { width: "100%", height: "100%" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: colors.bg.tint,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.border.tint,
    borderRadius: radii.lg,
  },
  emptyTitle: { marginTop: 6 },
  emptyHint: { marginTop: 2 },
  badge: {
    position: "absolute",
    right: 12.5,
    bottom: 6.5,
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F7FB",
    boxShadow: `0px 2px 8px ${hexAlpha(colors.shadow, 0.16)}`,
  },
  badgePressed: { backgroundColor: colors.bg.tintSoft },
  chip: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    minHeight: 28,
    borderRadius: 14,
  },
  chipReview: { backgroundColor: colors.pill.amber.bg },
  chipRejected: { backgroundColor: colors.pill.red.bg },
  chipText: { marginLeft: 5 },
  busy: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: hexAlpha(colors.brand.navy, 0.55),
  },
  busyText: { marginTop: 8 },
  bar: {
    marginTop: 8.5,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.bg.tint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  barPressed: { backgroundColor: colors.bg.tintPressed },
  barText: { marginLeft: 19 },
});
