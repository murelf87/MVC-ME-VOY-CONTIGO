import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { describeError } from "@/api/errors";
import { queryCache, useIsOnline } from "@/hooks";
import { Icon, type IconName } from "@/icons";
import { useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Avatar, Banner, Card, Checkbox, ErrorStateCard, OfflineBanner, Screen, ScreenHeader, Skeleton, Text } from "@/ui";
import { acceptLegal, uploadSelfie, type UploadPhase } from "../api";
import { AuthButton } from "../components/AuthButton";
import { TRUST, usePrivateCheckNotice, usePrivateCheckState, useProfilePhotoState } from "../hooks/useTrust";
import { buildNoticeBlocks, type NoticeBlock } from "../logic/legal";
import { deriveCheckView, derivePhotoView } from "../logic/verification";
import { authStrings } from "../strings";

const copy = authStrings.privacy;

/**
 * 07 · Privacidad de la comprobación. Muestra el aviso vigente (lo publica el servidor; si está «pendiente de revisión
 * jurídica» lo dice) con la foto pública y la captura privada desenfocada. «Continuar» exige la casilla: registra la
 * aceptación de esa versión (`context: private_check`) y SOLO entonces sube la captura, que cuenta un intento y queda
 * en revisión humana. Sin captura (acceso directo) manda a hacerla.
 */
export function PrivateCheckPrivacyScreen(_props: AppScreenProps<"PrivateCheckPrivacy">): React.JSX.Element {
  const navigation = useAppNavigation();
  const params = useAppRoute("PrivateCheckPrivacy").params;
  const online = useIsOnline();
  const { me } = useAuth();
  const notice = usePrivateCheckNotice();
  const check = usePrivateCheckState();
  const photo = useProfilePhotoState();
  const checkView = useMemo(() => (check.data !== undefined ? deriveCheckView(check.data) : null), [check.data]);
  const photoView = useMemo(() => (photo.data !== undefined ? derivePhotoView(photo.data) : null), [photo.data]);
  const blocks = useMemo(() => (notice.data !== undefined ? buildNoticeBlocks(notice.data) : []), [notice.data]);
  const cards = useMemo(() => {
    const block = blocks.find((entry) => entry.type === "cards");
    return block !== undefined && block.type === "cards" ? block.cards : [];
  }, [blocks]);
  const publicCard = cards[0] ?? { title: copy.publicPhotoTitle, text: copy.publicPhotoText };
  const privateCard = cards[1] ?? { title: copy.privateCheckTitle, text: copy.privateCheckText };

  const [accepted, setAccepted] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const alreadyAccepted = checkView !== null && checkView.consentAccepted && checkView.noticeVersion === (notice.data?.version ?? null);
  const checked = accepted || alreadyAccepted;
  const sending = phase !== null;
  const hasPhoto = params?.photoUri !== undefined && params.photoUri !== "";
  const publicUrl = photoView?.publicUrl ?? photoView?.previewUrl ?? null;

  const submit = useCallback(async () => {
    if (sending) return;
    setError(null);
    if (!checked) {
      setShowRequired(true);
      return;
    }
    if (params === undefined || notice.data === undefined) return;
    try {
      setPhase("preparing");
      if (!alreadyAccepted) await acceptLegal({ kind: "private_check_notice", version: notice.data.version, context: "private_check" });
      await uploadSelfie({ uri: params.photoUri, contentType: params.mimeType, sizeBytes: params.sizeBytes ?? 1 }, { onPhase: setPhase });
      await queryCache.invalidate(TRUST);
      setPhase(null);
      navigation.replace("PrivateCheckStatus", undefined);
    } catch (failure) {
      const described = describeError(failure);
      setError({ title: authStrings.privacy.uploadFailedTitle, message: described.message });
      setPhase(null);
    }
  }, [alreadyAccepted, checked, navigation, notice.data, params, sending]);

  const goOtherWay = useCallback(() => navigation.navigate("PrivateCheckOtherWay", undefined), [navigation]);

  return (
    <Screen
      testID="PrivateCheckPrivacy"
      padded={false}
      header={<ScreenHeader title={copy.title} testID="PrivateCheckPrivacy.header" />}
      footer={
        hasPhoto ? (
          <AuthButton label={copy.continue} onPress={() => void submit()} loading={sending} disabled={!online || notice.data === undefined} style={styles.footer} testID="PrivateCheckPrivacy.continue" />
        ) : (
          <AuthButton label={copy.noPhotoAction} onPress={() => navigation.replace("PrivateCheckCapture", undefined)} style={styles.footer} testID="PrivateCheckPrivacy.capture" />
        )
      }
    >
      {!online ? <OfflineBanner testID="PrivateCheckPrivacy.offline" /> : null}

      <Text variant="subtitle" color="heading" weight="medium" align="center" size={21} lineHeight={26} style={styles.heading}>
        {copy.heading}
      </Text>

      <View style={styles.pair}>
        <Card tone="green" padding={0} radius={18} style={styles.half} testID="PrivateCheckPrivacy.publicCard">
          <Text variant="rowTitle" color="success" size={17} lineHeight={20} align="center" style={styles.halfTitle}>
            {publicCard.title ?? copy.publicPhotoTitle}
          </Text>
          <Avatar source={publicUrl} name={me?.display_name ?? ""} size={100} style={styles.halfAvatar} testID="PrivateCheckPrivacy.publicPhoto" />
          <Text variant="body" color="body" size={17.5} lineHeight={22} align="center" style={styles.halfText}>
            {publicCard.text}
          </Text>
        </Card>
        <Card tone="blue" padding={0} radius={18} style={styles.half} testID="PrivateCheckPrivacy.privateCard">
          <Text variant="rowTitle" color="heading" size={17} lineHeight={20} align="center" style={styles.halfTitle}>
            {privateCard.title ?? copy.privateCheckTitle}
          </Text>
          <Avatar
            source={hasPhoto ? params?.photoUri : null}
            name={me?.display_name ?? ""}
            size={100}
            blurred
            badge="lock"
            badgeVariant="ring"
            style={styles.halfAvatar}
            testID="PrivateCheckPrivacy.privatePhoto"
          />
          <Text variant="body" color="body" size={17.5} lineHeight={22} align="center" style={styles.halfText}>
            {privateCard.text}
          </Text>
        </Card>
      </View>

      <View style={styles.messages} accessibilityLiveRegion="polite">
        {notice.isLoading && notice.data === undefined ? <Skeleton height={120} /> : null}
        {notice.isError && notice.data === undefined ? (
          <ErrorStateCard title={copy.loadFailedTitle} message={describeError(notice.error).message} actionLabel={authStrings.common.retry} onAction={() => void notice.refetch()} testID="PrivateCheckPrivacy.loadError" />
        ) : null}
        {!hasPhoto ? <Banner kind="warning" size="sm" title={copy.noPhotoTitle} message={copy.noPhotoMessage} testID="PrivateCheckPrivacy.noPhoto" /> : null}
        {sending ? (
          <Text variant="subtitle" color="muted" align="center" testID="PrivateCheckPrivacy.sending">
            {copy.sending}
          </Text>
        ) : null}
        {error !== null ? <Banner kind="error" size="sm" title={error.title} message={error.message} actionLabel={authStrings.common.retry} onAction={() => void submit()} testID="PrivateCheckPrivacy.error" /> : null}
      </View>

      {blocks.map((block, index) => (
        <Block key={`${block.type}-${index}`} block={block} onAction={goOtherWay} />
      ))}

      {notice.data !== undefined && notice.data.pendingLegalReview ? (
        <Text variant="caption" color="warning" align="center" style={styles.pending} testID="PrivateCheckPrivacy.pendingLegal">
          {`${copy.pendingLegal} · ${copy.noticeVersion(notice.data.version)}`}
        </Text>
      ) : null}

      <View style={styles.consent}>
        <Checkbox
          checked={checked}
          onChange={(value) => {
            setAccepted(value);
            if (value) setShowRequired(false);
          }}
          disabled={alreadyAccepted || sending}
          error={showRequired && !checked}
          label={copy.consent}
          testID="PrivateCheckPrivacy.consent"
        />
        {showRequired && !checked ? (
          <Text variant="caption" color="error" accessibilityRole="alert" style={styles.required} testID="PrivateCheckPrivacy.consentRequired">
            {copy.consentRequired}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

function Block({ block, onAction }: { block: NoticeBlock; onAction: () => void }): React.JSX.Element | null {
  switch (block.type) {
    case "cards":
      // Las viñetas «Título: texto» son las dos tarjetas de arriba (foto pública y captura privada).
      return null;
    case "list":
      return (
        <Card tone="blue" padding={0} radius={18} style={styles.row} testID="PrivateCheckPrivacy.uses">
          <RowIcon name="document" />
          <View style={styles.rowText}>
            <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{block.heading}</Text>
            {block.items.map((item) => (
              <View key={item} style={styles.bullet}>
                <Text variant="body" color="body" size={17.5} lineHeight={22}>{"•"}</Text>
                <Text variant="body" color="body" size={17.5} lineHeight={22} style={styles.bulletText}>{item}</Text>
              </View>
            ))}
          </View>
        </Card>
      );
    case "note":
      return (
        <Card tone="blue" padding={0} radius={18} style={styles.row} testID="PrivateCheckPrivacy.note">
          <RowIcon name="database" />
          <View style={styles.rowText}>
            <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{block.heading}</Text>
            <Text variant="body" color="body" size={17.5} lineHeight={22}>{block.text}</Text>
          </View>
        </Card>
      );
    case "action":
      return (
        <Pressable accessibilityRole="button" accessibilityLabel={block.heading} onPress={onAction} testID="PrivateCheckPrivacy.otherWay" style={({ pressed }) => [styles.row, styles.actionRow, pressed ? styles.pressed : null]}>
          <RowIcon name="idCard" />
          <View style={styles.rowText}>
            <Text variant="rowTitle" color="heading" size={19} lineHeight={23}>{block.heading}</Text>
            <Text variant="body" color="body" size={17.5} lineHeight={22}>{block.text}</Text>
          </View>
          <Icon name="chevronRight" size={26} color={colors.primary} />
        </Pressable>
      );
  }
}

function RowIcon({ name }: { name: IconName }): React.JSX.Element {
  return (
    <View style={styles.rowIcon}>
      <Icon name={name} size={26} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: 6 },
  pair: { flexDirection: "row", gap: 8, paddingHorizontal: 14, marginTop: 14 },
  half: { flex: 1, alignItems: "center", paddingBottom: 10 },
  halfTitle: { marginTop: 12, paddingHorizontal: 8 },
  halfAvatar: { marginTop: 12 },
  halfText: { marginTop: 8, paddingHorizontal: 4 },
  messages: { paddingHorizontal: 16, marginTop: 10, gap: 10 },
  row: { marginHorizontal: 16, marginTop: 8, flexDirection: "row", alignItems: "center", minHeight: 80, backgroundColor: colors.bg.tint, borderRadius: 18 },
  actionRow: { paddingRight: 14, borderWidth: 1, borderColor: colors.border.default },
  pressed: { opacity: 0.85 },
  rowIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bg.white, alignItems: "center", justifyContent: "center", marginLeft: 14, marginRight: 12 },
  rowText: { flex: 1, paddingVertical: 8, paddingRight: 12 },
  bullet: { flexDirection: "row", gap: 8, marginTop: 2 },
  bulletText: { flex: 1 },
  pending: { marginTop: 8, paddingHorizontal: 16 },
  consent: { paddingHorizontal: 16, marginTop: 14 },
  required: { marginTop: 4 },
  footer: { marginHorizontal: 16 },
});
