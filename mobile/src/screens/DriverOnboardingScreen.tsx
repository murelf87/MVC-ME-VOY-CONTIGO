import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../api/client";
import type {
  CompletePrivateUpload,
  PrivateDocument,
  Vehicle,
} from "../api/types";
import { Brand, Card, PrimaryButton } from "../components/UI";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";
import {
  pickVehicleImage,
  uploadVehicleImage,
  type SelectedVehicleImage,
} from "../vehicles/upload";

type Step = "vehicle" | "photo" | "insurance" | "review";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function latestDocument(
  documents: PrivateDocument[],
  vehicleId: string,
  kind: string
): PrivateDocument | null {
  return (
    documents.find(
      item => item.vehicle_id === vehicleId && item.kind === kind
    ) ?? null
  );
}

function insuranceIsDetectedExpired(document: PrivateDocument | null): boolean {
  if (!document?.detected_expires_on) return false;
  return document.detected_expires_on < todayIso();
}

export function DriverOnboardingScreen({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { token, logout } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [documents, setDocuments] = useState<PrivateDocument[]>([]);
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [passengerSeats, setPassengerSeats] = useState("4");
  const [vehiclePhoto, setVehiclePhoto] =
    useState<SelectedVehicleImage | null>(null);
  const [insurancePhoto, setInsurancePhoto] =
    useState<SelectedVehicleImage | null>(null);
  const [lastInsuranceAnalysis, setLastInsuranceAnalysis] =
    useState<CompletePrivateUpload["analysis"]>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeVehicle =
    vehicles.find(item => item.id === activeVehicleId) ?? vehicles[0] ?? null;

  const vehiclePhotoDocument = activeVehicle
    ? latestDocument(documents, activeVehicle.id, "vehicle_photo")
    : null;
  const insuranceDocument = activeVehicle
    ? latestDocument(documents, activeVehicle.id, "vehicle_insurance")
    : null;

  const hasVehiclePhoto = Boolean(vehiclePhotoDocument);
  const hasInsurance = Boolean(insuranceDocument);
  const insuranceExpired = insuranceIsDetectedExpired(insuranceDocument);

  const onboardingReady =
    Boolean(activeVehicle) &&
    hasVehiclePhoto &&
    hasInsurance &&
    !insuranceExpired;

  const step = useMemo<Step>(() => {
    if (!activeVehicle) return "vehicle";
    if (!hasVehiclePhoto) return "photo";
    if (!hasInsurance || insuranceExpired) return "insurance";
    return "review";
  }, [
    activeVehicle,
    hasVehiclePhoto,
    hasInsurance,
    insuranceExpired,
  ]);

  const loadState = useCallback(async () => {
    if (!token) return;
    const [vehicleResponse, documentResponse] = await Promise.all([
      apiRequest<{ vehicles: Vehicle[] }>("/v1/me/vehicles", { token }),
      apiRequest<{ documents: PrivateDocument[] }>("/v1/me/documents", {
        token,
      }),
    ]);
    setVehicles(vehicleResponse.vehicles);
    setDocuments(documentResponse.documents);
    setActiveVehicleId(current => {
      if (
        current &&
        vehicleResponse.vehicles.some(vehicle => vehicle.id === current)
      ) {
        return current;
      }
      return vehicleResponse.vehicles[0]?.id ?? null;
    });
  }, [token]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await loadState();
      } catch (e) {
        if (mounted) {
          setError(
            e instanceof ApiError
              ? e.message
              : "No se pudo preparar el registro de conductor."
          );
        }
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadState]);

  useEffect(() => {
    if (!booting && onboardingReady) {
      const timer = setTimeout(onComplete, 350);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [booting, onboardingReady, onComplete]);

  async function createVehicle() {
    if (!token) return;
    const seats = Number(passengerSeats);
    if (!make.trim() || !model.trim() || !plate.trim()) {
      setError("Completa marca, modelo y matrícula.");
      return;
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
      setError("Las plazas deben estar entre 1 y 8.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const vehicle = await apiRequest<Vehicle>("/v1/me/vehicles", {
        method: "POST",
        token,
        body: {
          make: make.trim(),
          model: model.trim(),
          plate: plate.trim(),
          passengerSeats: seats,
        },
      });
      await loadState();
      setActiveVehicleId(vehicle.id);
      setNotice("Coche guardado. Ahora necesitamos una foto real del vehículo.");
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "No se pudo registrar el coche."
      );
    } finally {
      setBusy(false);
    }
  }

  async function choosePhoto(
    kind: "vehicle_photo" | "vehicle_insurance",
    source: "camera" | "library"
  ) {
    setError("");
    setNotice("");
    try {
      const selected = await pickVehicleImage(
        source,
        kind === "vehicle_photo" ? "coche" : "seguro"
      );
      if (!selected) return;
      if (kind === "vehicle_photo") setVehiclePhoto(selected);
      else setInsurancePhoto(selected);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "No se pudo seleccionar la foto."
      );
    }
  }

  async function upload(
    kind: "vehicle_photo" | "vehicle_insurance"
  ) {
    if (!token || !activeVehicle) return;
    const selected =
      kind === "vehicle_photo" ? vehiclePhoto : insurancePhoto;
    if (!selected) {
      setError(
        kind === "vehicle_photo"
          ? "Haz o elige una foto del coche."
          : "Haz o elige una foto del seguro en vigor."
      );
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const completed = await uploadVehicleImage(
        token,
        activeVehicle.id,
        kind,
        selected
      );

      if (kind === "vehicle_photo") {
        setVehiclePhoto(null);
        setNotice("Foto del coche recibida. Queda pendiente de validación.");
      } else {
        setInsurancePhoto(null);
        setLastInsuranceAnalysis(completed.analysis ?? null);

        const detected =
          completed.analysis?.detected_expires_on ??
          completed.document.detected_expires_on ??
          null;

        if (detected && detected < todayIso()) {
          setError(
            `El seguro parece caducado desde ${detected}. Sube la renovación para continuar como conductor.`
          );
        } else if (detected) {
          setNotice(
            `Seguro recibido. Caducidad detectada: ${detected}. Queda pendiente de validación.`
          );
        } else {
          setNotice(
            "Seguro recibido. No se ha podido validar automáticamente la fecha; pasará a revisión manual."
          );
        }
      }

      await loadState();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudo completar la subida segura."
      );
    } finally {
      setBusy(false);
    }
  }

  if (booting) {
    return (
      <View style={s.loading}>
        <Brand />
        <ActivityIndicator
          color={C.blue}
          size="large"
          style={{ marginTop: 22 }}
        />
        <Text style={s.loadingText}>Preparando tu alta de conductor…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={s.wrap}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Brand />

      <View style={s.heading}>
        <View style={s.headingIcon}>
          <Ionicons name="car-sport" size={29} color={C.blue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Completa tu perfil de conductor</Text>
          <Text style={s.subtitle}>
            Antes de conducir necesitamos identificar tu coche y comprobar que
            el seguro está en vigor.
          </Text>
        </View>
      </View>

      <View style={s.progress}>
        {[
          ["1", "Coche", step === "vehicle"],
          ["2", "Foto", step === "photo"],
          ["3", "Seguro", step === "insurance"],
          ["4", "Revisión", step === "review"],
        ].map(([number, label, active]) => (
          <View key={String(number)} style={s.progressItem}>
            <View
              style={[
                s.progressDot,
                active ? s.progressDotActive : null,
              ]}
            >
              <Text
                style={[
                  s.progressNumber,
                  active ? s.progressNumberActive : null,
                ]}
              >
                {number}
              </Text>
            </View>
            <Text style={s.progressLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {!activeVehicle ? (
        <Card style={s.card}>
          <Text style={s.cardTitle}>Datos del coche</Text>
          <Text style={s.cardMeta}>
            La matrícula se normaliza y comprueba en el servidor.
          </Text>

          <TextInput
            value={make}
            onChangeText={setMake}
            style={s.input}
            placeholder="Marca · ej. SEAT"
            placeholderTextColor="#91A0BC"
          />
          <TextInput
            value={model}
            onChangeText={setModel}
            style={s.input}
            placeholder="Modelo · ej. León"
            placeholderTextColor="#91A0BC"
          />
          <TextInput
            value={plate}
            onChangeText={setPlate}
            style={s.input}
            placeholder="Matrícula"
            placeholderTextColor="#91A0BC"
            autoCapitalize="characters"
          />
          <TextInput
            value={passengerSeats}
            onChangeText={setPassengerSeats}
            style={s.input}
            placeholder="Plazas para pasajeros"
            placeholderTextColor="#91A0BC"
            keyboardType="number-pad"
            maxLength={1}
          />

          <PrimaryButton
            title={busy ? "Guardando coche…" : "Guardar coche"}
            onPress={() => void createVehicle()}
            disabled={busy}
          />
        </Card>
      ) : (
        <Card style={s.vehicleSummary}>
          <View style={s.vehicleIcon}>
            <Ionicons name="car-sport" size={27} color={C.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.vehicleName}>
              {activeVehicle.make} {activeVehicle.model}
            </Text>
            <Text style={s.vehicleMeta}>
              {activeVehicle.plate} · {activeVehicle.passenger_seats} plazas
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={23} color={C.mint} />
        </Card>
      )}

      {activeVehicle ? (
        <>
          <Text style={s.sectionTitle}>Foto obligatoria del coche</Text>
          <Card style={s.card}>
            {vehiclePhoto ? (
              <Image
                source={{ uri: vehiclePhoto.uri }}
                style={s.preview}
                resizeMode="cover"
              />
            ) : (
              <View
                style={[
                  s.placeholder,
                  hasVehiclePhoto ? s.placeholderDone : null,
                ]}
              >
                <Ionicons
                  name={hasVehiclePhoto ? "checkmark-circle" : "camera"}
                  size={38}
                  color={hasVehiclePhoto ? C.mint : C.blue}
                />
                <Text style={s.placeholderTitle}>
                  {hasVehiclePhoto
                    ? "Foto del coche recibida"
                    : "Que se vea el vehículo completo"}
                </Text>
                <Text style={s.placeholderMeta}>
                  Debe corresponder al coche y matrícula registrados.
                </Text>
              </View>
            )}

            {!hasVehiclePhoto ? (
              <>
                <View style={s.actionRow}>
                  <Pressable
                    style={s.outlineButton}
                    onPress={() =>
                      void choosePhoto("vehicle_photo", "camera")
                    }
                  >
                    <Ionicons
                      name="camera-outline"
                      size={19}
                      color={C.blue}
                    />
                    <Text style={s.outlineText}>Hacer foto</Text>
                  </Pressable>
                  <Pressable
                    style={s.outlineButton}
                    onPress={() =>
                      void choosePhoto("vehicle_photo", "library")
                    }
                  >
                    <Ionicons
                      name="images-outline"
                      size={19}
                      color={C.blue}
                    />
                    <Text style={s.outlineText}>Galería</Text>
                  </Pressable>
                </View>
                {vehiclePhoto ? (
                  <PrimaryButton
                    title={busy ? "Subiendo…" : "Enviar foto del coche"}
                    onPress={() => void upload("vehicle_photo")}
                    disabled={busy}
                  />
                ) : null}
              </>
            ) : null}
          </Card>

          <Text style={s.sectionTitle}>Seguro en vigor</Text>
          <Card style={s.card}>
            {insurancePhoto ? (
              <Image
                source={{ uri: insurancePhoto.uri }}
                style={s.preview}
                resizeMode="cover"
              />
            ) : (
              <View
                style={[
                  s.placeholder,
                  hasInsurance && !insuranceExpired
                    ? s.placeholderDone
                    : null,
                ]}
              >
                <Ionicons
                  name={
                    insuranceExpired
                      ? "warning"
                      : hasInsurance
                        ? "shield-checkmark"
                        : "document-text"
                  }
                  size={38}
                  color={
                    insuranceExpired
                      ? "#D84A4A"
                      : hasInsurance
                        ? C.mint
                        : C.blue
                  }
                />
                <Text style={s.placeholderTitle}>
                  {insuranceExpired
                    ? "Seguro caducado"
                    : hasInsurance
                      ? "Seguro recibido"
                      : "Fotografía el documento del seguro"}
                </Text>
                <Text style={s.placeholderMeta}>
                  Intentaremos detectar automáticamente su fecha de caducidad.
                </Text>
              </View>
            )}

            {insuranceDocument?.detected_expires_on ? (
              <View style={s.detected}>
                <Text style={s.detectedLabel}>Caducidad detectada</Text>
                <Text
                  style={[
                    s.detectedValue,
                    insuranceExpired ? s.detectedExpired : null,
                  ]}
                >
                  {insuranceDocument.detected_expires_on}
                </Text>
              </View>
            ) : null}

            {lastInsuranceAnalysis?.analysis_status === "needs_review" ||
            lastInsuranceAnalysis?.status === "pending" ? (
              <Text style={s.reviewNote}>
                La fecha necesita revisión manual antes de habilitar la
                conducción.
              </Text>
            ) : null}

            {!hasInsurance || insuranceExpired ? (
              <>
                <View style={s.actionRow}>
                  <Pressable
                    style={s.outlineButton}
                    onPress={() =>
                      void choosePhoto("vehicle_insurance", "camera")
                    }
                  >
                    <Ionicons
                      name="camera-outline"
                      size={19}
                      color={C.blue}
                    />
                    <Text style={s.outlineText}>Hacer foto</Text>
                  </Pressable>
                  <Pressable
                    style={s.outlineButton}
                    onPress={() =>
                      void choosePhoto("vehicle_insurance", "library")
                    }
                  >
                    <Ionicons
                      name="images-outline"
                      size={19}
                      color={C.blue}
                    />
                    <Text style={s.outlineText}>Galería</Text>
                  </Pressable>
                </View>
                {insurancePhoto ? (
                  <PrimaryButton
                    title={busy ? "Analizando…" : "Enviar y comprobar seguro"}
                    onPress={() => void upload("vehicle_insurance")}
                    disabled={busy}
                  />
                ) : null}
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      {onboardingReady ? (
        <Card style={s.readyCard}>
          <Ionicons name="checkmark-circle" size={30} color={C.mint} />
          <View style={{ flex: 1 }}>
            <Text style={s.readyTitle}>Registro del coche completado</Text>
            <Text style={s.readyText}>
              Puedes entrar en MVC. Para publicar o iniciar viajes, la foto y
              el seguro deben quedar aprobados y el seguro debe seguir vigente.
            </Text>
          </View>
        </Card>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      {busy ? (
        <ActivityIndicator color={C.blue} style={{ marginTop: 12 }} />
      ) : null}

      {onboardingReady ? (
        <PrimaryButton
          title="Entrar en MVC"
          onPress={onComplete}
          disabled={busy}
        />
      ) : null}

      <Pressable
        onPress={() => void logout()}
        style={s.logout}
        disabled={busy}
      >
        <Text style={s.logoutText}>Salir y usar otra cuenta</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: C.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  wrap: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 40,
    backgroundColor: "#fff",
  },
  heading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 28,
  },
  headingIcon: {
    width: 54,
    height: 54,
    borderRadius: 17,
    backgroundColor: C.mintPale,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 27,
    lineHeight: 31,
    fontWeight: "900",
    color: C.navy,
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: C.muted,
    marginTop: 5,
  },
  progress: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 14,
  },
  progressItem: {
    alignItems: "center",
    flex: 1,
  },
  progressDot: {
    width: 31,
    height: 31,
    borderRadius: 16,
    backgroundColor: "#EEF3FA",
    alignItems: "center",
    justifyContent: "center",
  },
  progressDotActive: {
    backgroundColor: C.blue,
  },
  progressNumber: {
    fontSize: 12,
    fontWeight: "900",
    color: C.muted,
  },
  progressNumberActive: {
    color: "#fff",
  },
  progressLabel: {
    marginTop: 5,
    fontSize: 9,
    fontWeight: "800",
    color: C.muted,
  },
  card: {
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: C.navy,
  },
  cardMeta: {
    fontSize: 11,
    lineHeight: 16,
    color: C.muted,
    marginTop: 3,
    marginBottom: 12,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 13,
    paddingHorizontal: 13,
    color: C.navy,
    fontSize: 14,
    marginBottom: 9,
    backgroundColor: "#fff",
  },
  vehicleSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  vehicleIcon: {
    width: 47,
    height: 47,
    borderRadius: 15,
    backgroundColor: C.pale,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleName: {
    fontSize: 15,
    fontWeight: "900",
    color: C.navy,
  },
  vehicleMeta: {
    fontSize: 11,
    color: C.muted,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: C.navy,
    marginTop: 18,
    marginBottom: 8,
  },
  preview: {
    width: "100%",
    height: 185,
    borderRadius: 14,
    backgroundColor: "#EEF3FA",
  },
  placeholder: {
    minHeight: 150,
    borderRadius: 14,
    backgroundColor: C.pale,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  placeholderDone: {
    backgroundColor: C.mintPale,
  },
  placeholderTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: C.navy,
    marginTop: 8,
    textAlign: "center",
  },
  placeholderMeta: {
    fontSize: 11,
    lineHeight: 16,
    color: C.muted,
    marginTop: 4,
    textAlign: "center",
  },
  actionRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 10,
  },
  outlineButton: {
    flex: 1,
    minHeight: 45,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.blue,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  outlineText: {
    color: C.blue,
    fontSize: 11,
    fontWeight: "900",
  },
  detected: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    backgroundColor: "#F7FAFF",
    borderRadius: 12,
    padding: 11,
  },
  detectedLabel: {
    fontSize: 11,
    color: C.muted,
    fontWeight: "800",
  },
  detectedValue: {
    fontSize: 13,
    color: C.navy,
    fontWeight: "900",
  },
  detectedExpired: {
    color: "#B93838",
  },
  reviewNote: {
    fontSize: 11,
    lineHeight: 16,
    color: "#8A5B11",
    backgroundColor: "#FFF6E8",
    padding: 10,
    borderRadius: 11,
    marginTop: 10,
  },
  readyCard: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: C.mintPale,
  },
  readyTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: C.navy,
  },
  readyText: {
    fontSize: 11,
    lineHeight: 16,
    color: C.muted,
    marginTop: 3,
  },
  error: {
    marginTop: 12,
    color: "#9E302D",
    backgroundColor: "#FFF0EF",
    borderRadius: 12,
    padding: 11,
    fontSize: 11,
    lineHeight: 16,
  },
  notice: {
    marginTop: 12,
    color: "#166C4B",
    backgroundColor: C.mintPale,
    borderRadius: 12,
    padding: 11,
    fontSize: 11,
    lineHeight: 16,
  },
  logout: {
    alignItems: "center",
    paddingVertical: 15,
    marginTop: 8,
  },
  logoutText: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "800",
  },
});
