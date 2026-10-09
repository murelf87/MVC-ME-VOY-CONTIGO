import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { SupportTicketDetail } from "@/api/types";
import { Banner, Button, Text } from "@/ui";
import type { UseTicketFormResult } from "../hooks/useTicketForm";
import { TICKET_BODY_MAX } from "../logic/support";
import { helpStrings } from "../strings";
import { AttachmentsField } from "./AttachmentsField";
import { CategoryTiles } from "./CategoryTiles";
import { ComposeField } from "./ComposeField";
import { TripSelect, TripSheet } from "./TripSelect";

export interface TicketFormProps {
  form: UseTicketFormResult;
  /** Se llama tras un envío correcto con la consulta creada (para abrir su hilo). */
  onSubmitted?: (ticket: SupportTicketDetail) => void;
  testID?: string;
}

function Label({ text, size, color, marginTop, lineHeight }: { text: string; size: number; color: "heading" | "deep"; marginTop: number; lineHeight: number }): React.JSX.Element {
  return (
    <Text variant="rowTitle" color={color} weight="semibold" size={size} lineHeight={lineHeight} accessibilityRole="header" style={{ marginTop }}>
      {text}
    </Text>
  );
}

/**
 * Formulario «Enviar consulta» de las láminas 35/36: tipo de consulta, viaje opcional, texto de hasta 500 caracteres,
 * imágenes opcionales y botón de envío con validación en español.
 */
export function TicketForm({ form, onSubmitted, testID = "TicketForm" }: TicketFormProps): React.JSX.Element {
  const [tripSheet, setTripSheet] = useState(false);

  const submit = async (): Promise<void> => {
    const created = await form.submit();
    if (created !== undefined) onSubmitted?.(created);
  };

  return (
    <View testID={testID}>
      <CategoryTiles value={form.category} onChange={form.setCategory} error={form.errors.category} disabled={form.submitting} testID={`${testID}.category`} />

      <Label text={helpStrings.help.tripLabel} size={18.3} color="deep" marginTop={12.5} lineHeight={23} />
      <View style={styles.afterLabel}>
        <TripSelect
          label={form.tripLabel}
          loading={form.trips.data === undefined && !form.trips.isError && !form.trips.isOffline}
          disabled={form.submitting}
          onPress={() => setTripSheet(true)}
          testID={`${testID}.trip`}
        />
      </View>
      {form.tripId !== null && form.tripLabel === null && form.trips.data !== undefined ? (
        <Text variant="rowText" color="muted" style={styles.hint}>
          {helpStrings.tickets.relatedTripUnknown}
        </Text>
      ) : null}

      <Label text={helpStrings.help.bodyLabel} size={19.3} color="heading" marginTop={13.5} lineHeight={24} />
      <ComposeField
        value={form.body}
        onChangeText={form.setBody}
        placeholder={helpStrings.help.bodyPlaceholder}
        maxLength={TICKET_BODY_MAX}
        error={form.errors.body}
        disabled={form.submitting}
        accessibilityLabel={helpStrings.help.bodyLabel}
        testID={`${testID}.body`}
        style={styles.afterLabel}
      />

      <Label text={helpStrings.help.attachLabel} size={18} color="deep" marginTop={0} lineHeight={23} />
      <View style={styles.afterLabel}>
        <AttachmentsField attachments={form.attachments} error={form.errors.attachments} disabled={form.submitting} testID={`${testID}.attachments`} />
      </View>

      {form.sendError !== null ? (
        <Banner
          testID={`${testID}.sendError`}
          kind={form.sendError.offline ? "warning" : "error"}
          title={form.sendError.title}
          message={form.sendError.message}
          actionLabel={helpStrings.common.retry}
          onAction={() => void submit()}
          style={styles.sendError}
        />
      ) : null}

      <Button
        testID={`${testID}.submit`}
        label={form.submitting ? helpStrings.help.submitting : helpStrings.help.submit}
        leadingIcon="navigate"
        loading={form.submitting}
        onPress={() => void submit()}
        style={styles.submit}
      />

      <TripSheet
        visible={tripSheet}
        trips={form.trips}
        selectedTripId={form.tripId}
        onSelect={(tripId) => {
          form.setTripId(tripId);
          setTripSheet(false);
        }}
        onClose={() => setTripSheet(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  afterLabel: { marginTop: 4.5 },
  hint: { marginTop: 6, paddingHorizontal: 4 },
  sendError: { marginTop: 10 },
  submit: { marginTop: 5, height: 60.5 },
});
