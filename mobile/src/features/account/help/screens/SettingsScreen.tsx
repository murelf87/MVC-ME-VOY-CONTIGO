import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { errorMessage } from "@/api";
import type { FontScale } from "@/api/types";
import { useIsOnline } from "@/hooks";
import { formatDateShort } from "@/i18n";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { useFontScale } from "@/theme";
import { Banner, ConfirmDialog, Screen, ScreenHeader, SectionHeader, Spinner, Switch, Text, showToast } from "@/ui";
import { getAppInfo } from "../appInfo";
import { FontSizeSheet } from "../components/FontSizeSheet";
import { MobileSheet } from "../components/MobileSheet";
import { ProfileCard, SettingsRow } from "../components/SettingsRows";
import { GuestNotice, OfflineNotice } from "../components/StateCards";
import { TextSizeGlyph } from "../components/TextSizeGlyph";
import { useSettings } from "../hooks/useSettings";
import { useSignOut } from "../hooks/useSignOut";
import { fontScaleLabel, formatPhoneDisplay, roleLine } from "../logic/settings";
import { helpStrings } from "../strings";

type Sheet = "mobile" | "font" | null;
type Changing = "share" | "font" | null;

function Gap({ size }: { size: number }): React.JSX.Element {
  return <View style={{ height: size }} />;
}

/**
 * Lámina 35b (y 34a, su versión anterior): «Ajustes». Cada fila hace algo real; los cambios se guardan con
 * `PATCH /v1/me/settings` mostrando «Guardando…» y, si falla, una franja con «Reintentar».
 */
export function SettingsScreen({ navigation }: AppScreenProps<"Settings">): React.JSX.Element {
  const auth = useAuth();
  const signedIn = auth.status === "signedIn";
  const online = useIsOnline();
  const { query, settings, save, setShareLiveLocation, chooseFont, retrySave } = useSettings();
  const fontScale = useFontScale();
  const { working, signOut } = useSignOut();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [changing, setChanging] = useState<Changing>(null);
  const wasSaving = useRef(false);

  // «Guardado»: aviso breve cuando termina un guardado sin error; si falla, el aviso permanente es la franja roja.
  useEffect(() => {
    if (wasSaving.current && !save.saving) {
      if (save.error === null && changing !== null) showToast({ message: helpStrings.settings.savedToast, kind: "success", durationMs: 2000 });
      setChanging(null);
    }
    wasSaving.current = save.saving;
  }, [save.saving, save.error, changing]);

  const roles = settings?.account.roles ?? auth.me?.roles ?? [];
  const name = settings?.account.displayName ?? auth.me?.display_name ?? helpStrings.settings.defaultName;
  const phone = formatPhoneDisplay(settings?.account.phoneE164 ?? auth.me?.phone_e164 ?? null);
  const photoUrl = settings?.account.photoUrl ?? null;
  const pendingDeletion = settings?.account.pendingDeletion ?? null;
  const app = getAppInfo();

  const requestPhoneChange = useCallback(() => {
    setSheet(null);
    navigation.navigate("HelpCenter", { category: "account_profile" });
  }, [navigation]);

  const toggleShare = useCallback(
    (value: boolean) => {
      setChanging("share");
      setShareLiveLocation(value);
    },
    [setShareLiveLocation],
  );

  const chooseSize = useCallback(
    (scale: FontScale) => {
      if (signedIn) setChanging("font");
      chooseFont(scale);
    },
    [chooseFont, signedIn],
  );

  const endSession = useCallback(async () => {
    try {
      await signOut();
    } catch (error) {
      showToast({ message: errorMessage(error), kind: "error" });
    } finally {
      setConfirmLogout(false);
    }
  }, [signOut]);

  const loadFailed = signedIn && settings === undefined && (query.isError || query.isOffline);
  const loadingSettings = signedIn && settings === undefined && !loadFailed;
  const failedFont = save.failed?.fontScale !== undefined;
  const savingShare = changing === "share" && save.saving;
  const savingFont = changing === "font" && save.saving;

  const shareTrailing = loadingSettings ? (
    <Spinner size="sm" />
  ) : settings === undefined ? (
    <Pressable
      testID="Settings.share.retry"
      accessibilityRole="button"
      accessibilityLabel={helpStrings.settings.retryRow}
      hitSlop={10}
      onPress={() => void query.refetch()}
      style={styles.retryLink}
    >
      <Text variant="rowTextStrong" color="link" underline size={16}>
        {helpStrings.settings.retryRow}
      </Text>
    </Pressable>
  ) : (
    <View style={styles.switchScale}>
      <Switch
        testID="Settings.share.switch"
        value={settings.shareLiveLocationInTrip}
        onValueChange={toggleShare}
        accessibilityLabel={helpStrings.settings.shareLocationA11y}
      />
    </View>
  );

  const fontRow = (
    <SettingsRow
      testID="Settings.row.fontSize"
      glyph={<TextSizeGlyph />}
      title={helpStrings.settings.fontSizeTitle}
      subtitle={savingFont ? `${fontScaleLabel(fontScale)} · ${helpStrings.settings.shareLocationSaving}` : fontScaleLabel(fontScale)}
      metrics={{ height: 69, subtitleSize: 18.5, subtitleGap: 2, glyphX: 44.5, textX: 87 }}
      textOffsetY={4}
      glyphOffsetY={-3}
      onPress={() => setSheet("font")}
    />
  );

  const permissionsRow = (
    <SettingsRow
      testID="Settings.row.permissions"
      icon="document"
      iconSize={32}
      title={helpStrings.settings.permissionsTitle}
      metrics={{ height: 56.5, glyphX: 45.75, textX: 90 }}
      onPress={() => navigation.navigate("AppPermissions")}
    />
  );

  return (
    <Screen
      testID="Settings"
      paddingX={14}
      header={<ScreenHeader title={helpStrings.settings.title} testID="Settings.header" />}
      refreshing={signedIn && query.isRefreshing}
      onRefresh={signedIn ? () => void query.refetch() : undefined}
      contentContainerStyle={styles.content}
    >
      {!online ? (
        <View style={styles.notice}>
          <OfflineNotice testID="Settings.offline" />
        </View>
      ) : null}

      {loadFailed && online ? (
        <Banner
          testID="Settings.loadError"
          kind="warning"
          title={helpStrings.settings.loadErrorTitle}
          message={helpStrings.settings.loadErrorMessage}
          actionLabel={helpStrings.common.retry}
          onAction={() => void query.refetch()}
          style={styles.notice}
        />
      ) : null}

      {save.error !== null ? (
        <Banner
          testID="Settings.saveError"
          kind="error"
          title={failedFont ? helpStrings.settings.fontSavedLocalOnly : helpStrings.settings.shareLocationError}
          message={errorMessage(save.error)}
          actionLabel={helpStrings.common.retry}
          onAction={retrySave}
          style={styles.notice}
        />
      ) : null}

      {pendingDeletion !== null ? (
        <Banner
          testID="Settings.pendingDeletion"
          kind="warning"
          title={helpStrings.settings.deletePendingTitle}
          message={helpStrings.settings.deletePendingMessage(formatDateShort(pendingDeletion.scheduledFor))}
          actionLabel={helpStrings.settings.deletePendingAction}
          onAction={() => navigation.navigate("DeleteAccount")}
          style={styles.notice}
        />
      ) : null}

      {signedIn ? (
        <>
          <ProfileCard
            testID="Settings.profile"
            name={name}
            roleLine={roleLine(roles)}
            photoUrl={photoUrl}
            onPress={() => navigation.navigate("MyProfile")}
          />
          <Gap size={13} />
          <SettingsRow
            testID="Settings.row.phone"
            icon="cellphone"
            iconSize={31}
            title={helpStrings.settings.phoneTitle}
            subtitle={phone ?? helpStrings.settings.phoneUnknown}
            metrics={{ height: 70.5, subtitleSize: 18.5, subtitleGap: 4, glyphX: 48.75 }}
            textOffsetY={0.75}
            onPress={() => setSheet("mobile")}
          />
          <Gap size={4} />
          <SettingsRow
            testID="Settings.row.notifications"
            icon="bell"
            iconSize={34.5}
            title={helpStrings.settings.notificationsTitle}
            subtitle={helpStrings.settings.notificationsSubtitle}
            metrics={{ height: 69.5 }}
            textOffsetY={0.75}
            onPress={() => navigation.navigate("NotificationSettings")}
          />
          <Gap size={5} />
          <SettingsRow
            testID="Settings.row.shareLocation"
            icon="pin"
            iconSize={35}
            title={helpStrings.settings.shareLocationTitle}
            subtitle={savingShare ? helpStrings.settings.shareLocationSaving : helpStrings.settings.shareLocationSubtitle}
            metrics={{ height: 72, titleSize: 18.5, glyphX: 48.5, textX: 85.5 }}
            textOffsetY={3}
            glyphOffsetY={-2.25}
            trailing={shareTrailing}
          />
          <Gap size={12} />
          {fontRow}
          <Gap size={17} />
          <SettingsRow
            testID="Settings.row.privacy"
            icon="lock"
            iconSize={30}
            title={helpStrings.settings.privacyTitle}
            metrics={{ height: 56, titleSize: 19.5, glyphX: 44, textX: 89 }}
            onPress={() => navigation.navigate("PrivacyData")}
          />
          <Gap size={4.5} />
          {permissionsRow}
          <Gap size={15} />
          <SettingsRow
            testID="Settings.row.deleteAccount"
            icon="trash"
            iconSize={32.5}
            title={helpStrings.settings.deleteTitle}
            tone="danger"
            destructive
            metrics={{ height: 60.5, titleSize: 21, glyphX: 46, textX: 88.5 }}
            onPress={() => navigation.navigate("DeleteAccount")}
          />
          <View
            accessible
            accessibilityLabel={`${helpStrings.settings.deleteHelperLine1} ${helpStrings.settings.deleteHelperLine2}`}
            style={styles.helper}
          >
            <Text variant="body" color="subtle" size={16} lineHeight={19}>
              {helpStrings.settings.deleteHelperLine1}
            </Text>
            <Text variant="body" color="subtle" size={16} lineHeight={19}>
              {helpStrings.settings.deleteHelperLine2}
            </Text>
          </View>
          <Gap size={20.5} />
          <SettingsRow
            testID="Settings.row.logout"
            icon="logout"
            iconSize={33}
            title={helpStrings.settings.logoutTitle}
            tone="white"
            destructive
            metrics={{ height: 57.5, titleSize: 21, glyphX: 48, textX: 88 }}
            onPress={() => setConfirmLogout(true)}
          />
        </>
      ) : (
        <>
          <GuestNotice
            testID="Settings.guest"
            message={helpStrings.settings.guestCardMessage}
            onSignIn={() => {
              requireAccount({ name: "Settings" });
            }}
          />
          <Gap size={14} />
          {fontRow}
          <Gap size={6} />
          {permissionsRow}
        </>
      )}

      <View style={styles.footer}>
        <SectionHeader title={helpStrings.settings.footerSection} />
        <Gap size={8} />
        <SettingsRow
          testID="Settings.row.help"
          icon="chatHelp"
          title={helpStrings.settings.footerHelp}
          tone="white"
          onPress={() => navigation.navigate("HelpCenter")}
        />
        <Gap size={6} />
        <SettingsRow
          testID="Settings.row.status"
          icon="signal"
          title={helpStrings.settings.footerStatus}
          tone="white"
          onPress={() => navigation.navigate("ServiceStatus")}
        />
        <Gap size={6} />
        <SettingsRow
          testID="Settings.row.legal"
          icon="documentOutline"
          title={helpStrings.settings.footerLegal}
          tone="white"
          onPress={() => navigation.navigate("LegalCenter")}
        />
        <Gap size={6} />
        <SettingsRow
          testID="Settings.row.about"
          icon="infoOutline"
          title={helpStrings.settings.footerAbout}
          tone="white"
          onPress={() => navigation.navigate("About")}
        />
        {!signedIn ? (
          <>
            <Gap size={6} />
            <SettingsRow
              testID="Settings.row.exitGuest"
              icon="logout"
              title={helpStrings.settings.guestLogoutTitle}
              tone="white"
              onPress={() => setConfirmLogout(true)}
            />
          </>
        ) : null}
        {app.version !== null ? (
          <Text variant="caption" color="subtle" align="center" style={styles.version} testID="Settings.version">
            {helpStrings.settings.footerVersion(app.version)}
          </Text>
        ) : null}
      </View>

      <FontSizeSheet visible={sheet === "font"} value={fontScale} onChoose={chooseSize} onClose={() => setSheet(null)} localOnly={!signedIn} />
      <MobileSheet visible={sheet === "mobile"} phone={phone} onClose={() => setSheet(null)} onRequestChange={requestPhoneChange} />
      <ConfirmDialog
        visible={confirmLogout}
        testID="Settings.logoutDialog"
        title={signedIn ? helpStrings.settings.logoutConfirmTitle : helpStrings.settings.guestLogoutConfirmTitle}
        message={signedIn ? helpStrings.settings.logoutConfirmMessage : helpStrings.settings.guestLogoutConfirmMessage}
        confirmLabel={signedIn ? helpStrings.settings.logoutConfirm : helpStrings.settings.guestLogoutConfirm}
        loading={working}
        icon="logout"
        onConfirm={() => void endSession()}
        onCancel={() => setConfirmLogout(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 3.5, paddingBottom: 32 },
  notice: { marginBottom: 10 },
  helper: { marginTop: 4, paddingHorizontal: 0.5 },
  switchScale: { transform: [{ scale: 1.0625 }], marginRight: 4 },
  retryLink: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  footer: { marginTop: 26 },
  version: { marginTop: 18 },
});
