/**
 * 29 · Mi perfil. Cabecera con la foto aprobada (o iniciales), nombre, «municipio, provincia» y la nota SOLO si existe;
 * tarjeta «Móvil verificado»; «Mis roles en MVC» (cambiar de modo o activar el que falta); «Mis datos» (editar perfil, mi
 * vehículo, privacidad) y, más abajo, mi actividad (viajes, favoritos y rutina) y cuenta (verificación, planes, pagos,
 * ajustes y ayuda). Todo navega a rutas reales.
 *
 * Datos: sesión (`GET /me`), estado de verificación (`GET /v1/me/verification`), destinos favoritos y provincias (para la
 * línea del municipio). Sin conexión se enseña la copia guardada del perfil y se avisa; si la verificación no carga, se
 * oculta su aviso y la fila de «Verificación y seguridad» sigue llevando a la pantalla de detalle.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { queryCache } from "@/hooks";
import { requireAccount } from "@/navigation";
import type { AppScreenProps } from "@/navigation/types";
import { useAuth } from "@/session";
import { Banner, ConfirmDialog, EmptyState, Screen, ScreenHeader } from "@/ui";
import { ProfileHeaderCard } from "../components/ProfileHeaderCard";
import { ProfileRow } from "../components/ProfileRow";
import { RoleCards } from "../components/RoleCards";
import { ListSkeleton, LoadFailure, OfflineNotice } from "../components/ScreenStates";
import { SectionTitle } from "../components/SectionTitle";
import { VerifiedCard } from "../components/VerifiedCard";
import { FAVORITES, VERIFICATION } from "../hooks/keys";
import { useProfileLocation } from "../hooks/useProvince";
import { useRoleSwitch } from "../hooks/useRoleSwitch";
import { useVerificationSummary, useViewer } from "../hooks/useVerification";
import { readOwnRating, roleCards, type VerificationNextKind } from "../model/profileHeader";
import { profileStrings } from "../strings";

const copy = profileStrings.myProfile;

/** Texto del aviso según lo primero que la persona debe hacer o esperar. */
function noticeFor(next: VerificationNextKind): { title: string; message: string } {
  switch (next) {
    case "photo_missing":
      return copy.verifyAction.photoMissing;
    case "photo_rejected":
      return copy.verifyAction.photoRejected;
    case "check_retry":
      return copy.verifyAction.checkRetry;
    case "check_rejected":
      return copy.verifyAction.checkRejected;
    case "identity_rejected":
      return copy.verifyAction.identityRejected;
    case "in_review":
      return copy.verifyAction.review;
  }
}

export function MyProfileScreen({ navigation }: AppScreenProps<"MyProfile">): React.JSX.Element {
  const { me, status, activeRole, roles, meStale, refreshMe } = useAuth();
  const signedIn = me !== null;
  const viewer = useViewer();
  const location = useProfileLocation();
  const verification = useVerificationSummary(signedIn);
  const roleSwitch = useRoleSwitch();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await Promise.all([refreshMe(), queryCache.invalidate(VERIFICATION), queryCache.invalidate(FAVORITES)]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshMe]);

  const header = <ScreenHeader title={copy.title} testID="MyProfile.nav" />;

  if (me === null) {
    if (status === "booting") {
      return (
        <Screen testID="MyProfile" header={header} padded={false}>
          <ListSkeleton testID="MyProfile.loading" count={4} variant="card" style={styles.loading} />
        </Screen>
      );
    }
    if (status === "signedIn") {
      // Sesión recordada, pero `/me` aún no se ha podido cargar.
      return (
        <Screen testID="MyProfile" header={header} padded={false}>
          <LoadFailure
            testID="MyProfile.error"
            title={copy.noProfileTitle}
            error={null}
            fallbackMessage={copy.noProfileMessage}
            onRetry={() => {
              void refreshMe();
            }}
          />
        </Screen>
      );
    }
    return (
      <Screen testID="MyProfile" header={header} padded={false}>
        <View style={styles.block}>
          <EmptyState
            testID="MyProfile.guest"
            icon="person"
            title={profileStrings.common.guestTitle}
            message={profileStrings.common.guestMessage}
            actionLabel={profileStrings.common.guestAction}
            onAction={() => {
              requireAccount({ name: "MyProfile" });
            }}
          />
        </View>
      </Screen>
    );
  }

  const rating = readOwnRating(me);
  const summary = verification.summary;
  const verificationSubtitle =
    summary === null
      ? copy.verification.subtitleLoading
      : summary.tone === "ok"
        ? copy.verification.subtitleOk
        : summary.tone === "review"
          ? copy.verification.subtitleReview
          : copy.verification.subtitleAction;
  const notice = summary !== null && summary.next !== null ? noticeFor(summary.next) : null;
  const openVerification = (): void => navigation.navigate("VerificationStatus");

  return (
    <Screen testID="MyProfile" header={header} padded={false} refreshing={refreshing} onRefresh={() => void onRefresh()} contentContainerStyle={styles.scroll}>
      {meStale ? (
        <OfflineNotice
          testID="MyProfile.offline"
          detail={copy.stale}
          onRetry={() => {
            void refreshMe();
          }}
          style={styles.offline}
        />
      ) : null}

      <View style={styles.block}>
        <ProfileHeaderCard
          name={me.display_name ?? ""}
          photoUrl={viewer?.photoUrl ?? null}
          location={location}
          rating={rating}
          onPress={() => navigation.navigate("EditProfile")}
        />

        <VerifiedCard onPress={openVerification} />

        {notice !== null && summary !== null ? (
          <Banner
            testID="MyProfile.verificationNotice"
            kind={summary.tone === "action" ? "warning" : "info"}
            title={notice.title}
            message={notice.message}
            size="sm"
            chevron
            accessibilityLabel={`${notice.title}. ${notice.message}`}
            onPress={openVerification}
            style={styles.notice}
          />
        ) : null}

        <SectionTitle title={copy.rolesHeading} style={styles.rolesTitle} testID="MyProfile.rolesHeading" />
        <RoleCards cards={roleCards(roles, activeRole)} onSelect={roleSwitch.selectRole} />

        <SectionTitle title={copy.dataHeading} style={styles.dataTitle} testID="MyProfile.dataHeading" />
        <View style={styles.rows}>
          <ProfileRow
            testID="MyProfile.row.edit"
            icon="person"
            iconSize={38}
            title={copy.editProfile.title}
            subtitle={copy.editProfile.subtitle}
            onPress={() => navigation.navigate("EditProfile")}
          />
          <ProfileRow
            testID="MyProfile.row.vehicle"
            icon="car"
            iconSize={42}
            title={copy.vehicle.title}
            subtitle={copy.vehicle.subtitle}
            onPress={() => roleSwitch.ensureRole("driver", "vehicle", () => navigation.navigate("MyVehicle"))}
          />
          <ProfileRow
            testID="MyProfile.row.privacy"
            icon="lock"
            iconSize={38}
            title={copy.privacy.title}
            subtitle={copy.privacy.subtitle}
            onPress={() => navigation.navigate("PrivacyData")}
          />
        </View>

        <SectionTitle title={copy.activityHeading} style={styles.sectionTitle} testID="MyProfile.activityHeading" />
        <View style={styles.rows}>
          <ProfileRow testID="MyProfile.row.trips" icon="calendarCheck" iconSize={38} title={copy.trips.title} subtitle={copy.trips.subtitle} onPress={() => navigation.navigate("MyTrips")} />
          <ProfileRow
            testID="MyProfile.row.favorites"
            icon="pin"
            iconSize={38}
            title={copy.favorites.title}
            subtitle={copy.favorites.subtitle}
            onPress={() => navigation.navigate("FavoritesRoutine")}
          />
        </View>

        <SectionTitle title={copy.accountHeading} style={styles.sectionTitle} testID="MyProfile.accountHeading" />
        <View style={styles.rows}>
          <ProfileRow testID="MyProfile.row.verification" icon="shield" iconSize={38} title={copy.verification.title} subtitle={verificationSubtitle} onPress={openVerification} />
          <ProfileRow testID="MyProfile.row.plans" icon="crown" iconSize={38} title={copy.plans.title} subtitle={copy.plans.subtitle} onPress={() => navigation.navigate("Plans")} />
          <ProfileRow testID="MyProfile.row.payments" icon="euro" iconSize={38} title={copy.payments.title} subtitle={copy.payments.subtitle} onPress={() => navigation.navigate("PaymentsEarnings")} />
          <ProfileRow testID="MyProfile.row.settings" icon="settings" iconSize={38} title={copy.settings.title} subtitle={copy.settings.subtitle} onPress={() => navigation.navigate("Settings")} />
          <ProfileRow testID="MyProfile.row.help" icon="help" iconSize={38} title={copy.help.title} subtitle={copy.help.subtitle} onPress={() => navigation.navigate("HelpCenter")} />
        </View>
      </View>

      <ConfirmDialog
        testID="MyProfile.roleDialog"
        visible={roleSwitch.dialog.visible}
        title={roleSwitch.dialog.title}
        message={roleSwitch.dialog.message}
        confirmLabel={roleSwitch.dialog.confirmLabel}
        loading={roleSwitch.dialog.loading}
        onConfirm={roleSwitch.dialog.onConfirm}
        onCancel={roleSwitch.dialog.onCancel}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  /** Las tarjetas de la lámina llegan a 13,5 pt del borde izquierdo y a 9 pt del derecho: se centran con 13,5 pt de cada lado. */
  block: { marginHorizontal: 13.5, marginTop: 14 },
  offline: { marginHorizontal: 13.5, marginTop: 8 },
  loading: { marginTop: 14 },
  notice: { marginTop: 10 },
  rolesTitle: { marginTop: 22.9, marginBottom: 14.1, marginLeft: 6 },
  dataTitle: { marginTop: 32.4, marginBottom: 16.6, marginLeft: 6 },
  sectionTitle: { marginTop: 36, marginBottom: 16.6, marginLeft: 6 },
  rows: { rowGap: 9.25 },
});
