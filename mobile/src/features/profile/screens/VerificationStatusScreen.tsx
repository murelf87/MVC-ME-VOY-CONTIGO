/**
 * Verificación y seguridad. Móvil, foto de perfil, comprobación privada e identidad/documentos con su estado REAL y la
 * acción que toca en cada uno (llevan a las pantallas de `auth`). Lo privado solo lo ve el equipo de revisión; no hay
 * reconocimiento facial y la selfie sola nunca verifica la identidad. Con el almacenamiento desactivado se dice claro.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { TrustDocumentSubmission } from "@/api/types";
import { useIsOnline } from "@/hooks";
import type { AppScreenProps } from "@/navigation/types";
import { colors } from "@/theme";
import { Banner, Button, Screen, ScreenHeader, StatusPill, Text, type StatusTone } from "@/ui";
import { ListSkeleton, LoadFailure, OfflineNotice } from "../components/ScreenStates";
import { useVerification } from "../hooks/useVerification";
import { profileStrings } from "../strings";

const copy = profileStrings.verification;

const PHOTO_TONE: Record<string, StatusTone> = { none: "gray", in_review: "amber", approved: "green", rejected: "red" };
const CHECK_TONE: Record<string, StatusTone> = { not_started: "gray", in_review: "amber", needs_retry: "orange", completed: "green", rejected: "red" };
const IDENTITY_TONE: Record<string, StatusTone> = { unverified: "gray", pending: "amber", verified: "green", rejected: "red" };
const DOC_TONE: Record<TrustDocumentSubmission["status"], StatusTone> = { in_review: "amber", approved: "green", rejected: "red" };

function Card({ title, tag, tone, message, reason, testID, children }: { title: string; tag: string; tone: StatusTone; message: string; reason?: string | null; testID: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        <Text variant="titleSm" color="heading" size={19} style={styles.flex}>{title}</Text>
        <StatusPill label={tag} tone={tone} size="sm" />
      </View>
      <Text variant="body" color="body" size={16}>{message}</Text>
      {reason ? <Text variant="body" color="warning" size={15.5}>{`${copy.reasonLabel}: ${reason}`}</Text> : null}
      {children}
    </View>
  );
}

export function VerificationStatusScreen({ navigation }: AppScreenProps<"VerificationStatus">): React.JSX.Element {
  const online = useIsOnline();
  const query = useVerification();
  const header = <ScreenHeader title={copy.title} testID="VerificationStatus.header" />;
  const data = query.data;

  if (data === undefined) {
    return (
      <Screen testID="VerificationStatus" header={header}>
        {query.isError || query.isOffline ? <LoadFailure testID="VerificationStatus.error" title={copy.loadErrorTitle} error={query.error} onRetry={() => void query.refetch()} /> : <ListSkeleton testID="VerificationStatus.loading" count={4} />}
      </Screen>
    );
  }

  const { photo, privateCheck, identity } = data;
  const photoCopy = copy.photo[photo.state];
  const photoAction = photo.state === "none" ? copy.photo.actionNone : photo.state === "rejected" ? copy.photo.actionRejected : photo.state === "approved" ? copy.photo.actionApproved : copy.photo.actionReview;
  const checkCopy = copy.privateCheck[privateCheck.state];
  const identityCopy = copy.identity[identity.status];
  const checkAction =
    privateCheck.nextAction === "capture" || privateCheck.nextAction === "accept_notice"
      ? copy.privateCheck.actionStart
      : privateCheck.nextAction === "retry_capture"
        ? copy.privateCheck.actionRetry
        : privateCheck.state === "in_review"
          ? copy.privateCheck.actionStatus
          : null;
  const anyStorageOff = !photo.uploadAvailable || !privateCheck.uploadAvailable || !identity.uploadAvailable;

  return (
    <Screen testID="VerificationStatus" header={header} refreshing={query.isRefreshing} onRefresh={() => void query.refetch()}>
      {query.isOffline || !online ? <OfflineNotice testID="VerificationStatus.offline" detail={copy.stale} onRetry={() => void query.refetch()} style={styles.gap} /> : null}
      <Text variant="body" color="body" size={16} style={styles.intro}>{copy.intro}</Text>
      {anyStorageOff ? <Banner testID="VerificationStatus.storageOff" kind="warning" message={copy.storageOff} /> : null}

      <Card testID="VerificationStatus.phone" title={copy.phone.title} tag={copy.phone.verified} tone="green" message={copy.phone.message} />

      <Card testID="VerificationStatus.photo" title={copy.photo.title} tag={photoCopy.tag} tone={PHOTO_TONE[photo.state] ?? "gray"} message={photoCopy.message} reason={photo.latest?.reason?.message ?? null}>
        <Button testID="VerificationStatus.photoAction" label={photoAction} variant={photo.state === "approved" ? "outline" : "primary"} chevron={false} disabled={!photo.uploadAvailable && photo.state !== "in_review"} onPress={() => navigation.navigate("ProfilePhoto")} style={styles.action} />
      </Card>

      <Card testID="VerificationStatus.privateCheck" title={copy.privateCheck.title} tag={checkCopy.tag} tone={CHECK_TONE[privateCheck.state] ?? "gray"} message={checkCopy.message} reason={privateCheck.reason?.message ?? null}>
        <Text variant="body" color="muted" size={14.5}>{copy.privateCheck.notice}</Text>
        {privateCheck.state !== "not_started" ? <Text variant="body" color="muted" size={14.5}>{copy.privateCheck.attempts(privateCheck.attempts.used, privateCheck.attempts.max)}</Text> : null}
        {checkAction !== null ? (
          <Button
            testID="VerificationStatus.checkAction"
            label={checkAction}
            chevron={false}
            disabled={!privateCheck.uploadAvailable && privateCheck.state !== "in_review"}
            onPress={() => navigation.navigate(privateCheck.state === "in_review" ? "PrivateCheckStatus" : "PrivateCheckCapture")}
            style={styles.action}
          />
        ) : null}
        {privateCheck.canUseAlternative && privateCheck.state !== "completed" ? (
          <Button testID="VerificationStatus.checkAlternative" label={copy.privateCheck.actionAlternative} variant="outline" chevron={false} onPress={() => navigation.navigate("PrivateCheckOtherWay", { reason: "prefer_document" })} style={styles.action} />
        ) : null}
      </Card>

      <Card testID="VerificationStatus.identity" title={copy.identity.title} tag={identityCopy.tag} tone={IDENTITY_TONE[identity.status] ?? "gray"} message={identityCopy.message}>
        {identity.documents.length === 0 ? (
          <Text variant="body" color="muted" size={15}>{copy.identity.noDocuments}</Text>
        ) : (
          identity.documents.map((doc) => (
            <View key={doc.id} style={styles.docRow} testID={`VerificationStatus.doc.${doc.id}`}>
              <Text variant="body" color="deep" size={16} style={styles.flex}>{copy.identity.documentKinds[doc.kind as keyof typeof copy.identity.documentKinds] ?? doc.kind}</Text>
              <StatusPill label={copy.identity.documentStates[doc.status]} tone={DOC_TONE[doc.status]} size="sm" />
            </View>
          ))
        )}
        {identity.driverLicense !== null ? (
          <View style={styles.docRow} testID="VerificationStatus.license">
            <Text variant="body" color="deep" size={16} style={styles.flex}>{copy.identity.driverLicense}</Text>
            <StatusPill label={copy.identity.documentStates[identity.driverLicense.status]} tone={DOC_TONE[identity.driverLicense.status]} size="sm" />
          </View>
        ) : null}
        {identity.status !== "verified" ? (
          <Button testID="VerificationStatus.identityAction" label={copy.identity.actionUpload} variant="outline" chevron={false} disabled={!identity.uploadAvailable} onPress={() => navigation.navigate("PrivateCheckOtherWay", { reason: "prefer_document" })} style={styles.action} />
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginBottom: 12 },
  intro: { marginBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  docRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  action: { marginTop: 10 },
  card: { marginTop: 12, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border.default, backgroundColor: "#FFFFFF", gap: 6 },
});

