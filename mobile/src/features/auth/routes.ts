/**
 * Rutas del slice `auth` (láminas 01 y 02: bienvenida, rol, cuenta, verificación del móvil, foto y comprobación privada).
 *
 * ANDAMIAJE: cada ruta apunta a `PendingScreen` hasta que el agente del slice escribe la pantalla real. Este fichero
 * es suyo desde ese momento: cambia `component`, ajusta los tipos de `AuthParams` y añade las rutas nuevas
 * (legal, permisos, recibos…) que necesite. Reglas:
 *  - `AuthParams` es un `type` (no `interface`) y SOLO lleva datos serializables (ids, textos, números).
 *  - Los nombres de ruta son únicos en TODA la app (el registro falla al arrancar si se repiten).
 *  - `access`: "public" (también invitados) · "auth" (por defecto) · "staff".
 *  - Pantalla = componente que recibe `AppScreenProps<"Nombre">`; navega con `useAppNavigation()` y lee los
 *    parámetros con `useAppRoute("Nombre")`.
 */
import { PendingScreen } from "@/navigation/PendingScreen";
import { defineRoute, type RouteDef } from "@/navigation/routeDef";
import type { Role } from "@/api/types";
import { CreateAccountScreen } from "./screens/CreateAccountScreen";
import { VerifyPhoneScreen } from "./screens/VerifyPhoneScreen";
import { ChooseRoleScreen } from "./screens/ChooseRoleScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";

export type AuthParams = {
  Welcome: undefined;
  /** Rol con el que se quiere empezar (se envía al pedir el código SMS). */
  ChooseRole: { initialRole?: Role } | undefined;
  CreateAccount:
    | {
        roles?: Role[];
        /** Datos con los que se abre el formulario (volver desde «Cambiar número de móvil», enlaces de invitación…). Solo rellena campos vacíos. */
        prefill?: { givenName?: string; familyName?: string; phone?: string; provinceCode?: string; accepted?: boolean };
      }
    | undefined;
  /** Datos del reto OTP devueltos por `startPhoneVerification`. */
  VerifyPhone: { challengeId: string; phoneE164: string; expiresAt: string; roles?: Role[] };
  /** Entrar con una cuenta existente (pide el móvil y manda al código). */
  SignIn: undefined;
  ProfilePhoto: undefined;
  PrivateCheckCapture: undefined;
  /** Foto recién hecha, pendiente de confirmar el aviso de privacidad. */
  PrivateCheckPrivacy: { photoUri: string; mimeType: string; sizeBytes: number | null };
  PrivateCheckStatus: undefined;
  // ── Páginas adicionales de producción (catálogo de docs/BUILD_BRIEF.md §10.3). Contrato entre equipos: añade parámetros opcionales, no renombres ni quites.
  PrivateCheckOtherWay: { reason?: "selfie_failed" | "prefer_document" } | undefined;
  LegalAcceptance: undefined;
  PermissionPrompt: { kind: "location" | "notifications" | "camera" | "photos" };
};

export const authRoutes: RouteDef[] = [
  defineRoute({ name: "Welcome", component: WelcomeScreen, access: "public", screen: "01", title: "Bienvenida" }),
  defineRoute({ name: "ChooseRole", component: ChooseRoleScreen, access: "public", screen: "02", title: "Elige cómo usar MVC" }),
  defineRoute({ name: "CreateAccount", component: CreateAccountScreen, access: "public", screen: "03", title: "Crear cuenta" }),
  defineRoute({ name: "VerifyPhone", component: VerifyPhoneScreen, access: "public", screen: "04", title: "Verifica tu móvil" }),
  defineRoute({ name: "SignIn", component: PendingScreen, access: "public", title: "Iniciar sesión" }),
  defineRoute({ name: "ProfilePhoto", component: PendingScreen, access: "auth", screen: "05", title: "Foto de perfil" }),
  defineRoute({ name: "PrivateCheckCapture", component: PendingScreen, access: "auth", screen: "06", title: "Comprobación privada" }),
  defineRoute({ name: "PrivateCheckPrivacy", component: PendingScreen, access: "auth", screen: "07", title: "Privacidad de la comprobación" }),
  defineRoute({ name: "PrivateCheckStatus", component: PendingScreen, access: "auth", screen: "08", title: "Estado de la comprobación" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({ name: "PrivateCheckOtherWay", component: PendingScreen, access: "auth", title: "Otra forma de verificar" }),
  defineRoute({ name: "LegalAcceptance", component: PendingScreen, access: "auth", title: "Acepta las condiciones" }),
  defineRoute({ name: "PermissionPrompt", component: PendingScreen, access: "public", title: "Permiso del sistema" }),
];
