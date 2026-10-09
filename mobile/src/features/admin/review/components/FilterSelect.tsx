/**
 * Selector compacto de las filas de filtros de 37, 38 y 39 («Todos ⌄», «Rol ⌄», «Más recientes ⌄», «📍 Sevilla ⌄»,
 * «📅 Últimos 30 días ⌄»): campo de 42 pt que abre una hoja con las opciones y marca la elegida.
 */
import React, { useCallback, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { IconName } from "@/icons";
import { OptionSheet, SelectField, type OptionSheetOption } from "@/ui";

export interface FilterSelectProps<T extends string> {
  /** Valor marcado en la hoja. */
  value: T;
  /** Texto que se ve en el campo (puede ser distinto de la etiqueta de la opción: «Rol» mientras no hay filtro de rol). */
  displayText: string;
  options: ReadonlyArray<OptionSheetOption<T>>;
  /** Título de la hoja de opciones. */
  sheetTitle: string;
  /** Nombre accesible del selector («Filtrar por rol»). */
  accessibilityLabel: string;
  leadingIcon?: IconName;
  /** Alto del campo en pt (42 en 38a; 45 en 39a). */
  height?: number;
  onChange: (value: T) => void;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

export function FilterSelect<T extends string>({
  value,
  displayText,
  options,
  sheetTitle,
  accessibilityLabel,
  leadingIcon,
  height = 42,
  onChange,
  disabled = false,
  testID,
  style,
}: FilterSelectProps<T>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const select = useCallback(
    (next: T) => {
      setOpen(false);
      if (next !== value) onChange(next);
    },
    [onChange, value],
  );
  return (
    <>
      <SelectField
        testID={testID}
        variant="compact"
        emphasis
        height={height}
        valueSize={18}
        leadingIcon={leadingIcon}
        valueLabel={displayText}
        accessibilityLabel={`${accessibilityLabel}: ${displayText}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={style}
      />
      <OptionSheet<T> visible={open} title={sheetTitle} options={options} selected={value} onSelect={select} onClose={close} testID={`${testID}.sheet`} />
    </>
  );
}
