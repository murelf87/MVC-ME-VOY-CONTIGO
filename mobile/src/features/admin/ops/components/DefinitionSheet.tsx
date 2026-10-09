/**
 * Hoja para DEFINIR un valor «Por definir» de la tarifa (lámina 40a): comisión del conductor, comisión del pasajero o
 * cuota Premium. Valida en español (porcentaje 0–100 con hasta 2 decimales; euros con hasta 2 decimales) y devuelve el
 * texto al formulario; «Dejar «Por definir»» vacía el campo. Nada se guarda hasta pulsar «Guardar borrador».
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { BottomSheet, Button, TextField } from "@/ui";
import { parseCentsAmount, parseCommission } from "../model/money";
import { opsStrings } from "../strings";
import type { DefinableField } from "./TariffCard";

export interface DefinitionSheetProps {
  /** Campo que se está definiendo; `null` = hoja cerrada. */
  field: DefinableField | null;
  /** Texto actual del campo en el formulario. */
  value: string;
  onApply: (field: DefinableField, text: string) => void;
  onClear: (field: DefinableField) => void;
  onClose: () => void;
}

const MISSING_VALUE = "Escribe un valor o elige «Dejar «Por definir»».";

function validate(field: DefinableField, text: string): string | null {
  const parsed = field === "premium" ? parseCentsAmount(text, "La cuota Premium") : parseCommission(text);
  if (!parsed.ok) return parsed.message;
  if (parsed.value === null) return MISSING_VALUE;
  return null;
}

export function DefinitionSheet({ field, value, onApply, onClear, onClose }: DefinitionSheetProps): React.JSX.Element {
  const d = opsStrings.definition;
  const [text, setText] = React.useState(value);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [shown, setShown] = React.useState<DefinableField>("driverCommission");

  React.useEffect(() => {
    if (field !== null) {
      setShown(field);
      setText(value);
      setError(undefined);
    }
  }, [field, value]);

  const premium = shown === "premium";
  const title = shown === "driverCommission" ? d.titleDriver : shown === "passengerCommission" ? d.titlePassenger : d.titlePremium;

  const apply = (): void => {
    const problem = validate(shown, text);
    if (problem !== null) {
      setError(problem);
      return;
    }
    onApply(shown, text.trim());
  };

  return (
    <BottomSheet
      visible={field !== null}
      onClose={onClose}
      title={title}
      subtitle={premium ? d.messagePremium : d.messageCommission}
      testID="OpsDefinitionSheet"
      footer={
        <View>
          <Button label={d.apply} chevron={false} onPress={apply} testID="OpsDefinitionSheet.apply" />
          <Button
            label={d.keepPending}
            variant="outline"
            chevron={false}
            onPress={() => onClear(shown)}
            testID="OpsDefinitionSheet.clear"
            style={styles.second}
          />
        </View>
      }
    >
      <TextField
        testID="OpsDefinitionSheet.input"
        label={premium ? d.premiumLabel : d.commissionLabel}
        variant="labeled"
        value={text}
        onChangeText={(next) => {
          setText(next);
          if (error !== undefined) setError(undefined);
        }}
        placeholder={premium ? d.premiumPlaceholder : d.commissionPlaceholder}
        keyboardType="decimal-pad"
        maxLength={10}
        error={error}
        onSubmitEditing={apply}
        returnKeyType="done"
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  second: { marginTop: 10 },
});
