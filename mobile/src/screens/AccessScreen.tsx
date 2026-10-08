import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ApiError } from "../api/client";
import type { Role } from "../api/types";
import { Card, PrimaryButton } from "../components/UI";
import { OfficialLogo } from "../components/OfficialLogo";
import { useAuth } from "../session/AuthContext";
import { C, shadow } from "../theme";
import { previewAccessMode, reportScreen } from "../previewHook";

type Mode = "login" | "register" | "forgot" | "reset";

const MODE_LABEL: Record<Mode, string> = {
  login: "Entrar",
  register: "Crear cuenta",
  forgot: "Recuperar contraseña",
  reset: "Nueva contraseña"
};

export function AccessScreen() {
  const { login, register, forgotPassword, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>(() => (previewAccessMode() === "register" ? "register" : "login"));

  useEffect(() => {
    reportScreen(MODE_LABEL[mode]);
  }, [mode]);
  const [roles, setRoles] = useState<Role[]>(["passenger"]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const hasDriver = roles.includes("driver");
  const subtitle = useMemo(() => {
    if (roles.length === 2) return "Pasajero y conductor";
    return roles[0] === "driver" ? "Conductor" : "Pasajero";
  }, [roles]);

  function toggle(role: Role) {
    setRoles(current => {
      if (current.includes(role)) {
        return current.length === 1 ? current : current.filter(item => item !== role);
      }
      return [...current, role];
    });
    setError("");
  }

  function go(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setCode("");
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? explain(e) : fallback);
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const address = email.trim();
    if (mode === "login") return void run(() => login(address, password), "No se pudo entrar.");
    if (mode === "register") return void run(() => register(address, password, roles), "No se pudo crear la cuenta.");
    if (mode === "forgot") {
      return void run(async () => {
        await forgotPassword(address);
        setMode("reset");
        setNotice("Si hay una cuenta con ese correo, te hemos enviado un código de 6 cifras.");
      }, "No se pudo enviar el código.");
    }
    return void run(() => resetPassword(address, code.trim(), password), "No se pudo cambiar la contraseña.");
  }

  const title = { login: "Entrar", register: "Crear cuenta", forgot: "Recuperar contraseña", reset: "Nueva contraseña" }[mode];
  const meta = {
    login: "Entra con tu correo y tu contraseña.",
    register: hasDriver
      ? "Crea tu cuenta y después completa el registro del coche."
      : `${subtitle}. Crea tu cuenta con tu correo.`,
    forgot: "Te enviaremos un código a tu correo para elegir otra contraseña.",
    reset: "Escribe el código que te hemos enviado y tu nueva contraseña.",
  }[mode];
  const action = {
    login: busy ? "Entrando…" : "Entrar",
    register: busy ? "Creando…" : "Crear cuenta",
    forgot: busy ? "Enviando…" : "Enviar código",
    reset: busy ? "Guardando…" : "Guardar y entrar",
  }[mode];
  const ready = email.includes("@") && (
    mode === "forgot" ||
    (mode === "login" && password.length > 0) ||
    (mode === "register" && password.length >= 10) ||
    (mode === "reset" && password.length >= 10 && code.trim().length === 6)
  );

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={s.wrap}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.brandRow}>
          <OfficialLogo width={222} />
          <View style={s.secureBadge}>
            <Ionicons name="shield-checkmark" size={14} color={C.blue} />
            <Text style={s.secureText}>Acceso seguro</Text>
          </View>
        </View>

        <View style={s.hero}>
          <Text style={s.eyebrow}>BIENVENIDO A MVC</Text>
          <Text style={s.title}>{mode === "register" ? "¿Cómo quieres viajar?" : "Viaja con quien va a tu destino"}</Text>
          <Text style={s.subtitle}>
            {mode === "register"
              ? "Elige pasajero, conductor o activa ambos perfiles."
              : "Comparte trayectos dentro de tu provincia."}
          </Text>
        </View>

        {mode === "register" ? (
        <>
        <View style={s.roles}>
          <Pressable
            onPress={() => toggle("passenger")}
            style={[s.roleCard, roles.includes("passenger") && s.roleActive]}
          >
            <View style={[s.roleIcon, s.passengerIcon]}>
              <Ionicons name="person" size={35} color={C.blue} />
              <Ionicons name="location" size={20} color={C.mint} style={s.cornerIcon} />
            </View>
            <View style={s.roleBody}>
              <View style={s.roleTitleRow}>
                <Text style={s.roleTitle}>Soy pasajero</Text>
                {roles.includes("passenger") ? (
                  <Ionicons name="checkmark-circle" size={21} color={C.blue} />
                ) : null}
              </View>
              <Text style={s.roleText}>
                Busca trayectos, solicita plaza y sigue el coche en directo.
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => toggle("driver")}
            style={[s.roleCard, roles.includes("driver") && s.roleActive]}
          >
            <View style={[s.roleIcon, s.driverIcon]}>
              <Ionicons name="car-sport" size={38} color={C.blue} />
              <Ionicons name="people" size={19} color={C.mint} style={s.cornerIcon} />
            </View>
            <View style={s.roleBody}>
              <View style={s.roleTitleRow}>
                <Text style={s.roleTitle}>Soy conductor</Text>
                {roles.includes("driver") ? (
                  <Ionicons name="checkmark-circle" size={21} color={C.blue} />
                ) : null}
              </View>
              <Text style={s.roleText}>
                Publica tus trayectos y decide qué solicitudes aceptar.
              </Text>
              <Text style={s.driverRequirement}>
                Durante el registro añadirás matrícula, datos del coche, foto del
                vehículo y seguro en vigor.
              </Text>
            </View>
          </Pressable>
        </View>

        <View style={s.bothRow}>
          <Ionicons name="people-circle-outline" size={21} color={C.blue} />
          <Text style={s.bothText}>Puedes activar ambos perfiles en una sola cuenta.</Text>
        </View>
        </>
        ) : null}

        <Card style={s.form}>
          <View style={s.formHeader}>
            <View style={s.phoneIcon}>
              <Ionicons name={mode === "login" ? "log-in-outline" : mode === "register" ? "person-add-outline" : "key-outline"} size={23} color={C.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.formTitle}>{title}</Text>
              <Text style={s.formMeta}>{meta}</Text>
            </View>
          </View>

          <Text style={s.label}>Correo electrónico</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            style={s.input}
            placeholder="tu@correo.es"
            placeholderTextColor="#91A0BC"
            editable={mode !== "reset"}
          />

          {mode === "reset" ? (
            <>
              <Text style={[s.label, s.gap]}>Código del correo</Text>
              <TextInput
                value={code}
                onChangeText={v => setCode(v.replace(/\D/g, ""))}
                keyboardType="number-pad"
                style={[s.input, s.codeInput]}
                placeholder="000000"
                placeholderTextColor="#91A0BC"
                maxLength={6}
              />
            </>
          ) : null}

          {mode !== "forgot" ? (
            <>
              <Text style={[s.label, s.gap]}>{mode === "login" ? "Contraseña" : "Nueva contraseña"}</Text>
              <View>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  textContentType={mode === "login" ? "password" : "newPassword"}
                  style={[s.input, { paddingRight: 48 }]}
                  placeholder={mode === "login" ? "Tu contraseña" : "Al menos 10 caracteres"}
                  placeholderTextColor="#91A0BC"
                  onSubmitEditing={() => ready && submit()}
                />
                <Pressable onPress={() => setShowPassword(v => !v)} style={s.eye} accessibilityLabel={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={21} color={C.muted} />
                </Pressable>
              </View>
              {mode !== "login" ? <Text style={s.hint}>Mínimo 10 caracteres. Una frase de varias palabras es fácil de recordar y difícil de adivinar.</Text> : null}
            </>
          ) : null}

          <View style={s.gap}>
            <PrimaryButton title={action} onPress={submit} disabled={busy || !ready} />
          </View>

          {mode === "login" ? (
            <Pressable style={s.restart} onPress={() => go("forgot")}>
              <Text style={s.restartText}>He olvidado mi contraseña</Text>
            </Pressable>
          ) : null}

          {busy ? <ActivityIndicator style={s.spinner} color={C.blue} /> : null}
          {notice ? <Text style={s.notice}>{notice}</Text> : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
        </Card>

        <Pressable style={s.switch} onPress={() => go(mode === "login" ? "register" : "login")}>
          <Text style={s.switchText}>
            {mode === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
            <Text style={s.switchLink}>{mode === "login" ? "Crear cuenta" : "Entrar"}</Text>
          </Text>
        </Pressable>

        {mode === "register" && hasDriver ? (
          <View style={s.driverInfo}>
            <Ionicons name="shield-checkmark-outline" size={22} color={C.blue} />
            <Text style={s.driverInfoText}>
              Un conductor no podrá publicar ni iniciar viajes hasta que la foto
              del coche y el seguro estén validados. Si el seguro caduca, MVC
              bloqueará la conducción hasta verificar la renovación.
            </Text>
          </View>
        ) : (
          <View style={s.trust}>
            <Ionicons name="shield-checkmark-outline" size={21} color={C.blue} />
            <Text style={s.trustText}>
              Tu contraseña se guarda cifrada y nadie de MVC puede verla. No
              existen contraseñas maestras.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Server codes in plain Spanish; anything else shows the server message. */
function explain(e: ApiError): string {
  const text: Record<string, string> = {
    INVALID_CREDENTIALS: "El correo o la contraseña no son correctos.",
    AUTH_TEMPORARILY_LOCKED: "Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar, o cambia la contraseña.",
    EMAIL_ALREADY_REGISTERED: "Ya hay una cuenta con ese correo. Entra o recupera la contraseña.",
    PASSWORD_TOO_WEAK: "La contraseña es demasiado corta o fácil de adivinar. Usa al menos 10 caracteres.",
    INVALID_EMAIL: "Revisa el correo: no parece válido.",
    AUTH_CODE_INVALID_OR_EXPIRED: "El código no es correcto o ha caducado. Pide otro.",
    EMAIL_PROVIDER_UNAVAILABLE: "Ahora mismo no podemos enviar correos. Inténtalo más tarde.",
    ACCOUNT_NOT_ACTIVE: "Esta cuenta está suspendida. Escribe a soporte.",
    RATE_LIMITED: "Demasiados intentos seguidos. Espera un minuto.",
  };
  return text[e.code] ?? e.message;
}

const s = StyleSheet.create({
  gap: { marginTop: 12 },
  eye: { position: "absolute", right: 6, top: 0, height: 54, width: 40, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 10, lineHeight: 15, color: C.muted, marginTop: 6 },
  notice: { marginTop: 12, color: C.navy, backgroundColor: C.pale, borderRadius: 12, padding: 11, fontSize: 11, lineHeight: 16 },
  switch: { alignItems: "center", paddingVertical: 16 },
  switchText: { fontSize: 13, color: C.muted, fontWeight: "700" },
  switchLink: { color: C.blue, fontWeight: "900" },
  root: { flex: 1, backgroundColor: "#fff" },
  wrap: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 14 : 22,
    paddingBottom: 42,
    backgroundColor: "#fff",
  },
  brandRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  secureBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.pale,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  secureText: { fontSize: 10, fontWeight: "900", color: C.blue },
  hero: { marginTop: 18, marginBottom: 18 },
  eyebrow: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    color: C.blue,
    marginBottom: 7,
  },
  title: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "900",
    color: C.navy,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: C.muted,
    marginTop: 5,
  },
  roles: { gap: 11 },
  roleCard: {
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: "#fff",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    ...shadow,
  },
  roleActive: { borderColor: C.blue, backgroundColor: "#F8FBFF" },
  roleIcon: {
    width: 74,
    height: 74,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
  },
  passengerIcon: { backgroundColor: C.pale },
  driverIcon: { backgroundColor: C.mintPale },
  cornerIcon: { position: "absolute", right: 9, bottom: 8 },
  roleBody: { flex: 1 },
  roleTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  roleTitle: { fontSize: 18, fontWeight: "900", color: C.navy },
  roleText: {
    fontSize: 12,
    lineHeight: 17,
    color: C.muted,
    marginTop: 4,
  },
  driverRequirement: {
    fontSize: 10,
    lineHeight: 15,
    color: C.blue,
    fontWeight: "800",
    marginTop: 6,
  },
  bothRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginVertical: 15,
  },
  bothText: {
    fontSize: 11,
    color: C.navy,
    fontWeight: "800",
    textAlign: "center",
  },
  form: { padding: 17 },
  formHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 15,
  },
  phoneIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: C.pale,
    alignItems: "center",
    justifyContent: "center",
  },
  formTitle: { fontSize: 18, fontWeight: "900", color: C.navy },
  formMeta: {
    fontSize: 11,
    lineHeight: 16,
    color: C.muted,
    marginTop: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: "900",
    color: C.navy,
    marginBottom: 7,
  },
  input: {
    height: 54,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 15,
    paddingHorizontal: 14,
    fontSize: 16,
    color: C.navy,
    backgroundColor: "#fff",
  },
  codeInput: {
    textAlign: "center",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 6,
  },
  restart: { alignItems: "center", padding: 12 },
  restartText: { fontSize: 11, fontWeight: "900", color: C.blue },
  spinner: { marginTop: 12 },
  error: {
    marginTop: 12,
    color: "#9E302D",
    backgroundColor: "#FFF0EF",
    borderRadius: 12,
    padding: 11,
    fontSize: 11,
    lineHeight: 16,
  },
  driverInfo: {
    flexDirection: "row",
    gap: 9,
    alignItems: "flex-start",
    backgroundColor: "#F7FAFF",
    borderRadius: 15,
    padding: 13,
    marginTop: 14,
  },
  driverInfoText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    color: C.muted,
  },
  trust: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    paddingHorizontal: 3,
    marginTop: 14,
  },
  trustText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    color: C.muted,
  },
});
