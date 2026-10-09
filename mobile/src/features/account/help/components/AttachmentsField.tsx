import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Icon } from "@/icons";
import { openAppSettings, pickPhotoFromLibrary, takePhoto, type ImagePickResult } from "@/platform";
import { colors, radii } from "@/theme";
import { Banner, OptionSheet, Spinner, Text } from "@/ui";
import type { DraftAttachment, UseSupportAttachmentsResult } from "../hooks/useSupportAttachments";
import { MAX_ATTACHMENTS, formatFileSize } from "../logic/support";
import { helpStrings } from "../strings";

type Source = "camera" | "gallery";
type Notice = { kind: "permission" | "unavailable" | "type" | "size" | "limit" } | null;

export interface AttachmentsFieldProps {
  attachments: UseSupportAttachmentsResult;
  /** Aviso de validación («Espera a que terminen de subirse…»). */
  error?: string;
  disabled?: boolean;
  testID?: string;
}

/**
 * «Adjuntar imágenes (opcional)» (36b): fila «Subir imagen», hoja con cámara/galería, miniaturas con estado de subida
 * (subiendo, lista, fallida con «Reintentar subida») y avisos de permiso o de almacenamiento no disponible.
 */
export function AttachmentsField({ attachments, error, disabled = false, testID = "Attachments" }: AttachmentsFieldProps): React.JSX.Element {
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handle = useCallback(
    (result: ImagePickResult) => {
      switch (result.status) {
        case "picked": {
          const added = attachments.add(result.image);
          setNotice(added.ok ? null : { kind: added.reason });
          return;
        }
        case "cancelled":
          return;
        case "permission_denied":
        case "permission_blocked":
          setNotice({ kind: "permission" });
          return;
        case "unavailable":
          setNotice({ kind: "unavailable" });
          return;
      }
    },
    [attachments],
  );

  const choose = useCallback(
    async (source: Source) => {
      setSheet(false);
      setBusy(true);
      const result = source === "camera" ? await takePhoto() : await pickPhotoFromLibrary();
      if (!mounted.current) return;
      setBusy(false);
      handle(result);
    },
    [handle],
  );

  const full = attachments.items.length >= MAX_ATTACHMENTS;
  const blocked = disabled || attachments.storageUnavailable || full;

  return (
    <View testID={testID}>
      <Pressable
        testID={`${testID}.add`}
        accessibilityRole="button"
        accessibilityLabel={helpStrings.help.attachButton}
        accessibilityState={{ disabled: blocked, busy }}
        disabled={blocked || busy}
        onPress={() => {
          setNotice(null);
          setSheet(true);
        }}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.bg.tintSoft : colors.bg.white, opacity: blocked ? 0.55 : 1 }]}
      >
        <View style={styles.rowIcon}>
          <Icon name="camera" size={32.5} color={colors.text.link} />
        </View>
        <Text variant="rowTitle" color="heading" weight="semibold" size={18} lineHeight={23} style={styles.rowLabel}>
          {helpStrings.help.attachButton}
        </Text>
        {busy ? <Spinner size="sm" /> : <Icon name="chevronRight" size={26} color={colors.heading} />}
      </Pressable>

      {attachments.items.length > 0 ? (
        <View style={styles.list}>
          {attachments.items.map((item, index) => (
            <AttachmentItem
              key={item.localId}
              item={item}
              index={index}
              testID={`${testID}.item.${index}`}
              onRemove={() => attachments.remove(item.localId)}
              onRetry={() => attachments.retry(item.localId)}
            />
          ))}
          <Text variant="rowText" color="subtle" style={styles.count} testID={`${testID}.count`}>
            {helpStrings.help.attachCount(attachments.items.length, MAX_ATTACHMENTS)}
          </Text>
        </View>
      ) : null}

      {attachments.storageUnavailable ? (
        <Banner
          testID={`${testID}.unavailable`}
          kind="warning"
          title={helpStrings.help.attachUnavailableTitle}
          message={helpStrings.help.attachUnavailableMessage}
          style={styles.banner}
        />
      ) : null}

      {notice !== null ? (
        <Banner
          testID={`${testID}.notice`}
          kind="warning"
          title={noticeTitle(notice)}
          message={noticeMessage(notice)}
          actionLabel={notice.kind === "permission" ? helpStrings.help.attachOpenSettings : undefined}
          onAction={notice.kind === "permission" ? () => void openAppSettings() : undefined}
          style={styles.banner}
        />
      ) : null}

      {error !== undefined ? (
        <View style={styles.error} accessibilityLiveRegion="polite" testID={`${testID}.error`}>
          <Icon name="alertCircle" size={16} color={colors.error.text} />
          <Text variant="rowText" color="error" style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      {full && !attachments.storageUnavailable ? (
        <Text variant="rowText" color="subtle" style={styles.count}>
          {helpStrings.help.attachLimit(MAX_ATTACHMENTS)}
        </Text>
      ) : null}

      <OptionSheet<Source>
        visible={sheet}
        title={helpStrings.help.attachSheetTitle}
        options={[
          { value: "camera", label: helpStrings.help.attachCamera, icon: "camera" },
          { value: "gallery", label: helpStrings.help.attachGallery, icon: "image" },
        ]}
        onSelect={(value) => void choose(value)}
        onClose={() => setSheet(false)}
        testID={`${testID}.sheet`}
      />
    </View>
  );
}

function noticeTitle(notice: NonNullable<Notice>): string {
  switch (notice.kind) {
    case "permission":
      return helpStrings.help.attachPermissionTitle;
    case "unavailable":
      return helpStrings.help.attachNoCamera;
    case "type":
      return helpStrings.help.attachType;
    case "size":
      return helpStrings.help.attachTooLarge;
    case "limit":
      return helpStrings.help.attachLimit(MAX_ATTACHMENTS);
  }
}

function noticeMessage(notice: NonNullable<Notice>): string | undefined {
  return notice.kind === "permission" ? helpStrings.help.attachPermissionMessage : undefined;
}

interface AttachmentItemProps {
  item: DraftAttachment;
  index: number;
  testID: string;
  onRemove: () => void;
  onRetry: () => void;
}

function AttachmentItem({ item, index, testID, onRemove, onRetry }: AttachmentItemProps): React.JSX.Element {
  const name = helpStrings.help.attachImageName(index + 1);
  const meta = [formatFileSize(item.sizeBytes), item.status === "uploading" ? helpStrings.help.attachUploading : null]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
  return (
    <View testID={testID} style={styles.item}>
      <View style={styles.thumbBox}>
        <Image source={{ uri: item.uri }} contentFit="cover" style={styles.thumb} accessibilityIgnoresInvertColors />
        {item.status === "uploading" ? (
          <View style={styles.thumbOverlay}>
            <Spinner size="sm" />
          </View>
        ) : null}
      </View>
      <View style={styles.itemText}>
        <Text variant="rowTitle" color="heading" size={16.5} lineHeight={21} numberOfLines={1}>
          {name}
        </Text>
        {item.status === "failed" ? (
          <Text variant="rowText" color="error" numberOfLines={2}>
            {item.error ?? helpStrings.help.attachFailed}
          </Text>
        ) : (
          <Text variant="rowText" color={item.status === "uploaded" ? "success" : "muted"} numberOfLines={1}>
            {meta !== "" ? meta : formatFileSize(item.sizeBytes)}
          </Text>
        )}
      </View>
      {item.status === "failed" ? (
        <Pressable
          testID={`${testID}.retry`}
          accessibilityRole="button"
          accessibilityLabel={`${helpStrings.help.attachRetry}. ${name}`}
          hitSlop={6}
          onPress={onRetry}
          style={styles.iconButton}
        >
          <Icon name="refresh" size={22} color={colors.primary} />
        </Pressable>
      ) : null}
      <Pressable
        testID={`${testID}.remove`}
        accessibilityRole="button"
        accessibilityLabel={helpStrings.help.attachRemove(name)}
        hitSlop={6}
        onPress={onRemove}
        style={styles.iconButton}
      >
        <Icon name="close" size={22} color={colors.text.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56.5,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    paddingLeft: 17,
    paddingRight: 7,
  },
  rowIcon: { width: 33, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, marginLeft: 22 },
  list: { marginTop: 8 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 64,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.soft,
    backgroundColor: colors.bg.tintSoft,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 4,
    marginBottom: 6,
  },
  thumbBox: { width: 52, height: 52, borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.bg.tint },
  thumb: { width: 52, height: 52 },
  thumbOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  itemText: { flex: 1, marginLeft: 12 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  count: { marginTop: 2, paddingHorizontal: 4 },
  banner: { marginTop: 8 },
  error: { flexDirection: "row", alignItems: "center", marginTop: 8, paddingHorizontal: 4 },
  errorText: { marginLeft: 6, flex: 1 },
});
