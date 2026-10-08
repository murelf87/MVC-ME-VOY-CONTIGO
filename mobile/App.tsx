import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Conversation, TripSearchParams } from "./src/api/types";
import { BottomNav, Brand } from "./src/components/UI";
import { AuthProvider, useAuth } from "./src/session/AuthContext";
import { AccessScreen } from "./src/screens/AccessScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { LiveScreen } from "./src/screens/LiveScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { DriverOnboardingScreen } from "./src/screens/DriverOnboardingScreen";
import { TripsScreen } from "./src/screens/OtherScreens";
import { MessagesScreen } from "./src/screens/MessagesScreen";
import { PublishScreen } from "./src/screens/PublishScreen";
import { AdminScreen } from "./src/screens/AdminScreen";
import { LegalScreen, usePendingLegal } from "./src/screens/LegalScreen";
import { NotificationsScreen, useUnreadNotifications, type AppNotification } from "./src/screens/NotificationsScreen";
import { C } from "./src/theme";

type Screen =
  | "home"
  | "trips"
  | "publish"
  | "messages"
  | "profile"
  | "live"
  | "notifications"
  | "admin";

function BootScreen() {
  return (
    <SafeAreaView style={s.boot}>
      <Brand />
      <ActivityIndicator color={C.blue} size="large" style={{ marginTop: 24 }} />
      <Text style={s.bootText}>Preparando MVC…</Text>
    </SafeAreaView>
  );
}

function AuthenticatedApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [searchParams, setSearchParams] = useState<TripSearchParams | null>(null);
  const [liveTarget, setLiveTarget] = useState<{ tripId?: string; provinceId?: string }>({});
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [tripsMode, setTripsMode] = useState<"available" | "mine" | "driver" | undefined>(undefined);
  const { token } = useAuth();
  const { unread, refresh: refreshUnread } = useUnreadNotifications(token);
  const legal = usePendingLegal(token);
  const main = ["home", "trips", "publish", "messages", "profile"].includes(screen);
  const navActive = main ? screen : screen === "admin" ? "profile" : screen === "notifications" ? "home" : "trips";

  const goMain = (next: string) => {
    if (["home", "trips", "publish", "messages", "profile"].includes(next)) {
      if (next === "messages") setConversation(null);
      if (next === "trips") setTripsMode(undefined);
      setScreen(next as Screen);
    }
  };

  useEffect(() => {
    if (screen === "home") void refreshUnread();
  }, [screen, refreshUnread]);

  // A new version can be published while the app is open: check again on every main tab change.
  useEffect(() => {
    if (main) void legal.refresh();
  }, [screen]);

    function runSearch(params: TripSearchParams) {
    setSearchParams(params);
    setTripsMode("available");
    setScreen("trips");
  }

  function openLive(target: { tripId?: string; provinceId?: string }) {
    setLiveTarget(target);
    setScreen("live");
  }

  function openNotification(n: AppNotification) {
    void refreshUnread();
    if (n.kind === "report.closed") return setScreen("profile");
    setTripsMode(n.as_driver ? "driver" : "mine");
    setScreen("trips");
  }

  function openChat(next: Conversation) {
    setConversation(next);
    setScreen("messages");
  }

  if (legal.pending.length) {
    return <LegalScreen documents={legal.pending} onAccepted={legal.setPending} />;
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      {!main ? (
        <View style={s.subHeader}>
          <Pressable onPress={() => { void refreshUnread(); setScreen(screen === "notifications" ? "home" : screen === "admin" ? "profile" : "trips"); }} style={s.back}>
            <Ionicons name="chevron-back" size={22} color={C.navy} />
            <Text style={s.backText}>Volver</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={s.body}>
        {screen === "home" && (
          <HomeScreen
            onSearch={runSearch}
            onOpenRoute={() => setScreen("publish")}
            onOpenNotifications={() => setScreen("notifications")}
            unread={unread}
          />
        )}
        {screen === "live" && <LiveScreen {...liveTarget} />}
        {screen === "notifications" && <NotificationsScreen onOpen={openNotification} />}
        {screen === "trips" && (
          <TripsScreen
            key={tripsMode ?? "default"}
            searchParams={searchParams}
            initialMode={tripsMode}
            onLive={openLive}
            onChat={openChat}
          />
        )}
        {screen === "publish" && <PublishScreen />}
        {screen === "messages" && (
          <MessagesScreen open={conversation} onOpen={setConversation} />
        )}
        {screen === "profile" && <ProfileScreen onOpenAdmin={() => setScreen("admin")} />}
        {screen === "admin" && <AdminScreen />}
      </View>

      <BottomNav active={navActive} onChange={goMain} />
    </SafeAreaView>
  );
}

function Root() {
  const { booting, token, roles } = useAuth();
  const [driverSetupDone, setDriverSetupDone] = useState(false);

  useEffect(() => {
    setDriverSetupDone(false);
  }, [token]);

  if (booting) return <BootScreen />;
  if (!token) return <AccessScreen />;

  if (roles.includes("driver") && !driverSetupDone) {
    return (
      <DriverOnboardingScreen
        onComplete={() => setDriverSetupDone(true)}
      />
    );
  }

  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  body: { flex: 1, backgroundColor: "#fff" },
  subHeader: {
    height: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF3FA",
  },
  back: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start" },
  backText: { fontSize: 14, fontWeight: "800", color: C.navy },
  boot: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  bootText: { marginTop: 12, color: C.muted, fontSize: 13, fontWeight: "700" },
});
