/**
 * Tarjeta de la cola «Usuarios y revisión» (38a/38b): avatar, nombre, rol y estado de la persona; una fila por elemento
 * entregado (identidad, permiso, foto, comprobación privada) con su acceso directo a la derecha; «Ver expediente ›» y,
 * si el servidor deja decidir y el rol escribe, «Aprobar» / «Rechazar» sobre lo que está en revisión.
 *
 * Los textos de cada fila («Identidad · En revisión», «DNI verificado»…) los compone el servidor; la app solo los pinta.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { AdminReviewQueueItem, AdminReviewRow } from "@/api/types";
import { Icon, IconTile } from "@/icons";
import { colors } from "@/theme";
import { Avatar, Button, Text, type StatusTone } from "@/ui";
import { resolvePublicPhoto } from "../logic/photo";
import { cardA11yLabel, roleChip, rowAccessory, showQuickDecisions, statusTone, type RowAccessory } from "../logic/reviewQueue";
import { reviewStrings } from "../strings";
import { SoftActionButton } from "./SoftActionButton";

const s = reviewStrings.users;

/** Rol de la persona en una cápsula azul clara con su icono (38a: «🚗 Conductora», «👤 Pasajero»). */
export function RoleChip({ label, icon, testID }: { label: string; icon: "car" | "person"; testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} style={styles.chip}>
      <Icon name={icon} size={22} color={colors.primary} />
      <Text variant="body" color={colors.primary} weight="medium" size={17.5} lineHeight={21} letterSpacing={-0.2} numberOfLines={1} style={styles.chipText}>
        {label}
      </Text>
    </View>
  );
}

/** Píldora de estado de la tarjeta («Pendiente», «Cancelada»): 36 pt de alto, texto de 17 pt. */
export function CardStatusPill({ label, tone, testID }: { label: string; tone: StatusTone; testID?: string }): React.JSX.Element {
  const palette = colors.pill[tone];
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text variant="rowTextStrong" color={palette.fg} weight="medium" size={17} lineHeight={21} letterSpacing={-0.2} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Lo que va a la derecha de cada fila: reloj, «Requiere revisión», visto verde, aspa roja o flecha de repetir. */
export function RowAccessoryView({ accessory, testID }: { accessory: RowAccessory; testID?: string }): React.JSX.Element | null {
  switch (accessory.kind) {
    case "badge":
      return (
        <View testID={testID} style={styles.badge}>
          <Text variant="rowTextStrong" color={colors.pill.amber.fg} weight="medium" size={17} lineHeight={21} letterSpacing={-0.2} numberOfLines={1}>
            {accessory.text}
          </Text>
        </View>
      );
    case "clock":
      return (
        <View testID={testID} style={styles.symbol}>
          <Icon name="clock" size={29} color={colors.pill.gray.fg} />
        </View>
      );
    case "check":
      return (
        <View testID={testID} style={styles.symbol}>
          <IconTile name="check" tone="solidGreen" size={27} iconSize={18} />
        </View>
      );
    case "cross":
      return (
        <View testID={testID} style={styles.symbol}>
          <IconTile name="close" tone="solidRed" size={27} iconSize={18} />
        </View>
      );
    case "retry":
      return (
        <View testID={testID} style={styles.symbol}>
          <IconTile name="refresh" tone="solidAmber" size={27} iconSize={17} />
        </View>
      );
    case "none":
      return null;
  }
}

function ItemRow({ row, testID }: { row: AdminReviewRow; testID: string }): React.JSX.Element {
  const accessory = rowAccessory(row);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={s.rowA11y(row.label, s.rowStates[row.state], row.badge)}
      style={styles.row}
    >
      <View style={styles.rowIcon}>
        <Icon name="documentOutline" size={26} color={colors.primary} />
      </View>
      <Text variant="body" color="body" size={17.5} lineHeight={22} letterSpacing={-0.1} numberOfLines={1} style={styles.rowLabel}>
        {row.label}
      </Text>
      <RowAccessoryView accessory={accessory} testID={`${testID}.accessory`} />
    </View>
  );
}

export type QueueBusy = "approve" | "reject" | null;

export interface ReviewQueueCardProps {
  item: AdminReviewQueueItem;
  /** El rol puede decidir sobre revisiones (`review: write`). */
  canWrite: boolean;
  /** Es la propia persona de personal: nadie decide sobre su propio expediente. */
  isOwn: boolean;
  /** Decisión en curso sobre esta tarjeta (bloquea los botones). */
  busy: QueueBusy;
  onOpenDossier: (userId: string) => void;
  onApprove: (item: AdminReviewQueueItem) => void;
  onReject: (item: AdminReviewQueueItem) => void;
  testID: string;
}

export function ReviewQueueCard({ item, canWrite, isOwn, busy, onOpenDossier, onApprove, onReject, testID }: ReviewQueueCardProps): React.JSX.Element {
  const chip = roleChip(item.roles);
  const quick = !isOwn && showQuickDecisions(item, canWrite);
  const pending = item.statusLabel !== "" ? item.statusLabel : s.statusNone;
  const tone = statusTone(item.tab);
  return (
    <View testID={testID} style={styles.card}>
      <View testID={`${testID}.head`} accessible accessibilityLabel={cardA11yLabel(item)} style={styles.head}>
        <Avatar source={resolvePublicPhoto(item.photoUrl)} name={item.displayName} size={72} />
        <View style={styles.headText}>
          <Text variant="titleSm" color="heading" size={21} lineHeight={26} letterSpacing={-0.2} numberOfLines={1} style={styles.name}>
            {item.displayName}
          </Text>
          <RoleChip label={chip.label} icon={chip.icon === "car" ? "car" : "person"} testID={`${testID}.role`} />
        </View>
        <View style={styles.pillSlot} pointerEvents="none">
          <CardStatusPill label={pending} tone={tone} testID={`${testID}.status`} />
        </View>
      </View>

      {item.rows.length > 0 ? (
        <View style={styles.rows}>
          {item.rows.map((row) => (
            <ItemRow key={row.key} row={row} testID={`${testID}.row.${row.key}`} />
          ))}
        </View>
      ) : null}

      <Button
        label={s.viewDossier}
        accessibilityLabel={`${s.viewDossier}: ${item.displayName}`}
        onPress={() => onOpenDossier(item.userId)}
        style={styles.view}
        testID={`${testID}.view`}
      />

      {quick ? (
        <View style={styles.decisions}>
          <SoftActionButton
            kind="approve"
            label={s.approve}
            accessibilityLabel={`${s.approve}: ${item.displayName}`}
            loading={busy === "approve"}
            disabled={busy !== null}
            onPress={() => onApprove(item)}
            style={styles.decisionLeft}
            testID={`${testID}.approve`}
          />
          <SoftActionButton
            kind="reject"
            label={s.reject}
            accessibilityLabel={`${s.reject}: ${item.displayName}`}
            loading={busy === "reject"}
            disabled={busy !== null}
            onPress={() => onReject(item)}
            style={styles.decisionRight}
            testID={`${testID}.reject`}
          />
        </View>
      ) : isOwn ? (
        <Text testID={`${testID}.own`} variant="rowText" color="muted" style={styles.own}>
          {reviewStrings.dossier.selfReview}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Medidas de 38a (pt): tarjeta de 372 × 299,5 con borde de 1 pt y esquina de 12; avatar de 72 a 15 pt del borde; fila
 * de 30; «Ver expediente» de 42,5 y los dos botones suaves de 44,5, con el contenido entre x = 26 y x = 374.
 */
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.soft,
    paddingTop: 14,
    paddingBottom: 13,
    paddingLeft: 14,
    paddingRight: 8,
  },
  head: { flexDirection: "row", alignItems: "flex-start", height: 72 },
  headText: { flex: 1, marginLeft: 13, paddingRight: 112 },
  name: { marginTop: 8 },
  pillSlot: { position: "absolute", top: 4, right: 5 },
  chip: {
    alignSelf: "flex-start",
    height: 31.5,
    marginTop: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    paddingLeft: 8,
    paddingRight: 12,
    backgroundColor: colors.bg.chip,
  },
  chipText: { marginLeft: 7 },
  pill: { height: 36, borderRadius: 18, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  rows: { marginTop: 7 },
  row: { height: 30, flexDirection: "row", alignItems: "center" },
  rowIcon: { width: 39, alignItems: "flex-start", paddingLeft: 1 },
  rowLabel: { flex: 1, paddingRight: 8 },
  symbol: { width: 29, height: 29, alignItems: "center", justifyContent: "center" },
  badge: { height: 30.5, borderRadius: 15.25, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.pill.amber.bg },
  view: { marginTop: 7.5, height: 42.5 },
  decisions: { marginTop: 7, flexDirection: "row" },
  decisionLeft: { flex: 1, marginRight: 3.5 },
  decisionRight: { flex: 1, marginLeft: 3.5 },
  own: { marginTop: 8, paddingHorizontal: 4 },
});
