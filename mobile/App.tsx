import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3000";

type Screen = "home" | "login" | "account" | "status";
type Role = "passenger" | "driver";
type BackendState = "checking" | "online" | "offline";

type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  token?: string
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const raw = await response.text();
  const data = raw ? (JSON.parse(raw) as T & ApiError) : ({} as T & ApiError);

  if (!response.ok) {
    throw new Error(
      data.error?.message ??
        data.error?.code ??
        `HTTP ${response.status}`
    );
  }

  return data as T;
}

function Brand() {
  return (
    <View style={styles.brandRow}>
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>MVC</Text>
      </View>
      <View>
        <Text style={styles.brandName}>Me voy contigo</Text>
        <Text style={styles.brandTagline}>Compartir trayecto. Llegar mejor.</Text>
      </View>
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.backButton}>
      <Text style={styles.backButtonText}>‹ Volver</Text>
    </Pressable>
  );
}

function StatusPill({ state }: { state: BackendState }) {
  const label =
    state === "checking"
      ? "Comprobando"
      : state === "online"
        ? "Backend conectado"
        : "Backend sin conexión";

  return (
    <View
      style={[
        styles.statusPill,
        state === "online" && styles.statusPillOnline,
        state === "offline" && styles.statusPillOffline,
      ]}
    >
      <View
        style={[
          styles.statusDot,
          state === "online" && styles.statusDotOnline,
          state === "offline" && styles.statusDotOffline,
        ]}
      />
      <Text style={styles.statusText}>{label}</Text>
    </View>
  );
}
export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [backend, setBackend] = useState<BackendState>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("+34");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [roles, setRoles] = useState<Role[]>(["passenger"]);
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);

  const isLoggedIn = Boolean(token);

  const roleLabel = useMemo(() => {
    if (roles.length === 2) return "Pasajero y conductor";
    return roles[0] === "driver" ? "Conductor" : "Pasajero";
  }, [roles]);

  async function checkBackend() {
    setBackend("checking");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(`${API_URL}/health/live`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      setBackend(response.ok ? "online" : "offline");
    } catch {
      setBackend("offline");
    }
  }

  useEffect(() => {
    void checkBackend();
  }, []);

  function toggleRole(role: Role) {
    setRoles((current) => {
      if (current.includes(role)) {
        return current.length === 1
          ? current
          : current.filter((item) => item !== role);
      }
      return [...current, role];
    });
  }

  async function startPhoneVerification() {
    setBusy(true);
    setMessage("");
    try {
      const data = await requestJson<{
        challengeId: string;
        expiresAt: string;
      }>("/v1/auth/phone/start", {
        method: "POST",
        body: JSON.stringify({ phone, roles }),
      });
      setChallengeId(data.challengeId);
      setMessage("Código enviado. Introdúcelo para continuar.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar el acceso");
    } finally {
      setBusy(false);
    }
  }

  async function verifyPhone() {
    setBusy(true);
    setMessage("");
    try {
      const data = await requestJson<{
        token: string;
        expiresAt: string;
        user: { id: string; roles: Role[] };
      }>("/v1/auth/phone/verify", {
        method: "POST",
        body: JSON.stringify({ challengeId, code }),
      });
      setToken(data.token);
      setRoles(data.user.roles);
      setMessage("");
      setScreen("account");
      await loadProfile(data.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo verificar el código");
    } finally {
      setBusy(false);
    }
  }

  async function loadProfile(activeToken = token) {
    if (!activeToken) return;
    setBusy(true);
    try {
      const data = await requestJson<Record<string, unknown>>(
        "/me",
        undefined,
        activeToken
      );
      setProfile(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar el perfil");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!token) return;
    setBusy(true);
    try {
      await requestJson("/v1/auth/logout", { method: "POST" }, token);
    } catch {
      // A local logout still clears the in-memory token if the server is unreachable.
    } finally {
      setToken("");
      setProfile(null);
      setCode("");
      setChallengeId("");
      setBusy(false);
      setScreen("home");
    }
  }
  function renderHome() {
    return (
      <>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>MOVILIDAD COMPARTIDA</Text>
          <Text style={styles.heroTitle}>
            Tu trayecto diario,{"\n"}con alguien que va contigo.
          </Text>
          <Text style={styles.heroCopy}>
            Encuentra o publica viajes dentro de tu provincia y sigue el trayecto
            con información en directo.
          </Text>

          <Pressable
            style={styles.primaryButton}
            onPress={() => setScreen(isLoggedIn ? "account" : "login")}
          >
            <Text style={styles.primaryButtonText}>
              {isLoggedIn ? "Abrir mi cuenta" : "Entrar en MVC"}
            </Text>
          </Pressable>

          <Pressable style={styles.secondaryButton} onPress={() => setScreen("status")}>
            <Text style={styles.secondaryButtonText}>Ver estado de la app</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Lo que podrás hacer</Text>
        <View style={styles.grid}>
          <View style={styles.featureCard}>
            <Text style={styles.featureNumber}>01</Text>
            <Text style={styles.featureTitle}>Buscar viaje</Text>
            <Text style={styles.featureText}>
              Rutas publicadas, plazas disponibles y horarios dentro de tu provincia.
            </Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureNumber}>02</Text>
            <Text style={styles.featureTitle}>Viaje en directo</Text>
            <Text style={styles.featureText}>
              Seguimiento del coche, posición reciente y estado del trayecto.
            </Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureNumber}>03</Text>
            <Text style={styles.featureTitle}>Pasajero o conductor</Text>
            <Text style={styles.featureText}>
              Una sola cuenta puede usar ambos roles con permisos separados.
            </Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureNumber}>04</Text>
            <Text style={styles.featureTitle}>Solicitud de plaza</Text>
            <Text style={styles.featureText}>
              El conductor acepta o rechaza antes de que exista una reserva.
            </Text>
          </View>
        </View>
      </>
    );
  }

  function renderLogin() {
    return (
      <>
        <BackButton onPress={() => setScreen("home")} />
        <Text style={styles.pageTitle}>Accede con tu teléfono</Text>
        <Text style={styles.pageCopy}>
          MVC usa verificación por teléfono. No hay contraseña maestra ni códigos
          universales.
        </Text>

        <Text style={styles.label}>Quiero usar MVC como</Text>
        <View style={styles.roleRow}>
          {(["passenger", "driver"] as Role[]).map((role) => {
            const selected = roles.includes(role);
            return (
              <Pressable
                key={role}
                onPress={() => toggleRole(role)}
                style={[styles.roleButton, selected && styles.roleButtonSelected]}
              >
                <Text
                  style={[
                    styles.roleButtonText,
                    selected && styles.roleButtonTextSelected,
                  ]}
                >
                  {role === "passenger" ? "Pasajero" : "Conductor"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.roleHint}>{roleLabel}</Text>

        <Text style={styles.label}>Número de teléfono</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoCapitalize="none"
          placeholder="+34 600 000 000"
        />

        {!challengeId ? (
          <Pressable
            disabled={busy}
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            onPress={() => void startPhoneVerification()}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Enviar código</Text>
            )}
          </Pressable>
        ) : (
          <>
            <Text style={styles.label}>Código recibido</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              placeholder="000000"
              maxLength={10}
            />
            <Pressable
              disabled={busy}
              style={[styles.primaryButton, busy && styles.buttonDisabled]}
              onPress={() => void verifyPhone()}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>Verificar y entrar</Text>
              )}
            </Pressable>
          </>
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}
      </>
    );
  }
  function renderAccount() {
    return (
      <>
        <BackButton onPress={() => setScreen("home")} />
        <Text style={styles.pageTitle}>Mi cuenta MVC</Text>
        <Text style={styles.pageCopy}>
          La información que ves aquí procede del endpoint protegido del backend.
        </Text>

        <View style={styles.accountCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>MVC</Text>
          </View>
          <View style={styles.accountInfo}>
            <Text style={styles.accountName}>
              {String(profile?.display_name ?? "Perfil MVC")}
            </Text>
            <Text style={styles.accountMeta}>{roleLabel}</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Estado de identidad</Text>
          <Text style={styles.infoValue}>
            {String(profile?.identity_status ?? "Pendiente de cargar")}
          </Text>
          <View style={styles.divider} />
          <Text style={styles.infoLabel}>Estado de foto pública</Text>
          <Text style={styles.infoValue}>
            {String(profile?.public_photo_status ?? "Pendiente de cargar")}
          </Text>
        </View>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => void loadProfile()}
          disabled={busy}
        >
          <Text style={styles.secondaryButtonText}>Actualizar perfil</Text>
        </Pressable>
        <Pressable style={styles.dangerButton} onPress={() => void logout()}>
          <Text style={styles.dangerButtonText}>Cerrar sesión</Text>
        </Pressable>

        {busy ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </>
    );
  }

  function renderStatus() {
    return (
      <>
        <BackButton onPress={() => setScreen("home")} />
        <Text style={styles.pageTitle}>Estado técnico</Text>
        <Text style={styles.pageCopy}>
          Esta pantalla comprueba el backend real configurado para esta build.
        </Text>

        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>API</Text>
          <Text selectable style={styles.apiText}>{API_URL}</Text>
          <View style={styles.divider} />
          <Text style={styles.infoLabel}>Conectividad</Text>
          <StatusPill state={backend} />
        </View>

        <Pressable style={styles.primaryButton} onPress={() => void checkBackend()}>
          <Text style={styles.primaryButtonText}>Comprobar de nuevo</Text>
        </Pressable>

        <View style={styles.endpointCard}>
          <Text style={styles.endpointTitle}>Contratos conectados</Text>
          <Text style={styles.endpoint}>GET /health/live</Text>
          <Text style={styles.endpoint}>POST /v1/auth/phone/start</Text>
          <Text style={styles.endpoint}>POST /v1/auth/phone/verify</Text>
          <Text style={styles.endpoint}>GET /me</Text>
          <Text style={styles.endpoint}>POST /v1/auth/logout</Text>
        </View>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Brand />
        <StatusPill state={backend} />
        {screen === "home" && renderHome()}
        {screen === "login" && renderLogin()}
        {screen === "account" && renderAccount()}
        {screen === "status" && renderStatus()}
        <Text style={styles.footer}>MVC · Me voy contigo · Expo SDK 57</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f5f8f6" },
  container: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40 },
  brandRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  brandMark: {
    width: 54, height: 54, borderRadius: 18, backgroundColor: "#103b2b",
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  brandMarkText: { color: "#ffffff", fontSize: 17, fontWeight: "900", letterSpacing: 1 },
  brandName: { color: "#13251e", fontSize: 21, fontWeight: "800" },
  brandTagline: { color: "#67756f", fontSize: 12, marginTop: 2 },
  statusPill: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center",
    backgroundColor: "#edf0ef", borderRadius: 999, paddingHorizontal: 12,
    paddingVertical: 8, marginBottom: 24,
  },
  statusPillOnline: { backgroundColor: "#e4f4ea" },
  statusPillOffline: { backgroundColor: "#f8e8e7" },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9ba5a1", marginRight: 8 },
  statusDotOnline: { backgroundColor: "#2d8a57" },
  statusDotOffline: { backgroundColor: "#bd4940" },
  statusText: { color: "#33443d", fontSize: 12, fontWeight: "700" },
  hero: {
    backgroundColor: "#ffffff", borderRadius: 30, padding: 24,
    borderWidth: 1, borderColor: "#e2e8e4", marginBottom: 28,
  },
  eyebrow: { color: "#2d8a57", fontSize: 11, fontWeight: "900", letterSpacing: 1.4, marginBottom: 12 },
  heroTitle: { color: "#10271e", fontSize: 31, lineHeight: 37, fontWeight: "900", letterSpacing: -0.8 },
  heroCopy: { color: "#65736d", fontSize: 15, lineHeight: 22, marginTop: 14, marginBottom: 22 },
  primaryButton: {
    minHeight: 54, backgroundColor: "#103b2b", borderRadius: 18,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 10,
  },
  primaryButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  secondaryButton: {
    minHeight: 52, backgroundColor: "#ecf3ef", borderRadius: 18,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 10,
  },
  secondaryButtonText: { color: "#174c37", fontSize: 14, fontWeight: "800" },
  dangerButton: {
    minHeight: 50, borderWidth: 1, borderColor: "#e2b5b1", borderRadius: 18,
    alignItems: "center", justifyContent: "center", marginTop: 10,
  },
  dangerButtonText: { color: "#9d372f", fontWeight: "800" },
  buttonDisabled: { opacity: 0.55 },
  sectionTitle: { color: "#172a22", fontSize: 20, fontWeight: "900", marginBottom: 12 },
  grid: { gap: 12 },
  featureCard: {
    backgroundColor: "#ffffff", borderRadius: 22, padding: 19,
    borderWidth: 1, borderColor: "#e4e9e6",
  },
  featureNumber: { color: "#64a380", fontSize: 11, fontWeight: "900", marginBottom: 8 },
  featureTitle: { color: "#193028", fontSize: 17, fontWeight: "800", marginBottom: 5 },
  featureText: { color: "#6b7872", fontSize: 13, lineHeight: 19 },
  backButton: { alignSelf: "flex-start", paddingVertical: 8, paddingRight: 16, marginBottom: 8 },
  backButtonText: { color: "#245d46", fontSize: 15, fontWeight: "800" },
  pageTitle: { color: "#13291f", fontSize: 29, fontWeight: "900", letterSpacing: -0.5, marginTop: 4 },
  pageCopy: { color: "#68766f", fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  label: { color: "#263b32", fontSize: 13, fontWeight: "800", marginBottom: 8, marginTop: 14 },
  input: {
    minHeight: 54, borderWidth: 1, borderColor: "#d8e0dc", backgroundColor: "#ffffff",
    borderRadius: 16, paddingHorizontal: 16, color: "#162820", fontSize: 16,
  },
  roleRow: { flexDirection: "row", gap: 10 },
  roleButton: {
    flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1,
    borderColor: "#d7dfdb", backgroundColor: "#ffffff",
    alignItems: "center", justifyContent: "center",
  },
  roleButtonSelected: { backgroundColor: "#103b2b", borderColor: "#103b2b" },
  roleButtonText: { color: "#52625b", fontWeight: "800" },
  roleButtonTextSelected: { color: "#ffffff" },
  roleHint: { color: "#738179", fontSize: 12, marginTop: 8 },
  message: {
    marginTop: 16, color: "#7f3c36", backgroundColor: "#faeeee",
    borderRadius: 14, padding: 13, fontSize: 13, lineHeight: 18,
  },
  accountCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#ffffff",
    borderWidth: 1, borderColor: "#e0e7e3", borderRadius: 22, padding: 18, marginBottom: 12,
  },
  avatar: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: "#103b2b",
    alignItems: "center", justifyContent: "center", marginRight: 14,
  },
  avatarText: { color: "#ffffff", fontWeight: "900", fontSize: 14 },
  accountInfo: { flex: 1 },
  accountName: { color: "#172b22", fontSize: 18, fontWeight: "900" },
  accountMeta: { color: "#718078", fontSize: 13, marginTop: 4 },
  infoCard: {
    backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e0e7e3",
    borderRadius: 22, padding: 18, marginTop: 4, marginBottom: 10,
  },
  infoLabel: { color: "#7a8781", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  infoValue: { color: "#20352c", fontSize: 16, fontWeight: "800", marginTop: 5 },
  divider: { height: 1, backgroundColor: "#edf0ee", marginVertical: 15 },
  apiText: { color: "#20352c", fontSize: 13, fontWeight: "700", marginTop: 7 },
  endpointCard: {
    backgroundColor: "#172b22", borderRadius: 22, padding: 18, marginTop: 14,
  },
  endpointTitle: { color: "#ffffff", fontSize: 15, fontWeight: "900", marginBottom: 12 },
  endpoint: { color: "#cfe0d8", fontSize: 12, marginVertical: 4, fontFamily: "monospace" },
  footer: { textAlign: "center", color: "#9aa49f", fontSize: 11, marginTop: 30 },
});
