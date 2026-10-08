import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { apiRequest } from "../api/client";
import type {
  MeProfile,
  Role,
  SessionInfo,
  SessionPayload,
} from "../api/types";

const TOKEN_KEY = "mvc.session.token";

async function readStoredToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function writeStoredToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function clearStoredToken(): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

type AuthContextValue = {
  booting: boolean;
  token: string | null;
  profile: MeProfile | null;
  roles: Role[];
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, roles: Role[]): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(email: string, code: string, newPassword: string): Promise<void>;
  refreshProfile(): Promise<void>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<MeProfile | null>(null);

  async function loadProfile(activeToken: string): Promise<MeProfile> {
    const me = await apiRequest<MeProfile>("/me", { token: activeToken });
    setProfile(me);
    return me;
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const stored = await readStoredToken();
        if (!stored) return;
        await apiRequest<SessionInfo>("/v1/auth/session", { token: stored });
        if (!mounted) return;
        setToken(stored);
        await loadProfile(stored);
      } catch {
        await clearStoredToken().catch(() => undefined);
        if (mounted) {
          setToken(null);
          setProfile(null);
        }
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function adopt(result: SessionPayload): Promise<void> {
    await writeStoredToken(result.token);
    setToken(result.token);
    await loadProfile(result.token);
  }

  async function login(email: string, password: string): Promise<void> {
    await adopt(await apiRequest<SessionPayload>("/v1/auth/login", { method: "POST", body: { email, password } }));
  }

  async function register(email: string, password: string, requestedRoles: Role[]): Promise<void> {
    await adopt(await apiRequest<SessionPayload>("/v1/auth/register", {
      method: "POST", body: { email, password, roles: requestedRoles },
    }));
  }

  async function forgotPassword(email: string): Promise<void> {
    await apiRequest("/v1/auth/password/forgot", { method: "POST", body: { email } });
  }

  async function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    await adopt(await apiRequest<SessionPayload>("/v1/auth/password/reset", {
      method: "POST", body: { email, code, newPassword },
    }));
  }

  async function refreshProfile(): Promise<void> {
    if (!token) return;
    await loadProfile(token);
  }

  async function logout(): Promise<void> {
    const activeToken = token;
    setToken(null);
    setProfile(null);
    await clearStoredToken();
    if (activeToken) {
      await apiRequest<void>("/v1/auth/logout", {
        method: "POST",
        token: activeToken,
      }).catch(() => undefined);
    }
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      booting,
      token,
      profile,
      roles: profile?.roles ?? [],
      login,
      register,
      forgotPassword,
      resetPassword,
      refreshProfile,
      logout,
    }),
    [booting, token, profile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
