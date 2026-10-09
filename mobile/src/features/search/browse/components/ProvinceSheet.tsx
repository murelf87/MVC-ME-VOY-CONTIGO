import React from "react";
import { StyleSheet, View } from "react-native";
import type { Province } from "@/api/types";
import { BottomSheet, RadioRow } from "@/ui";
import { browseStrings } from "../strings";

const copy = browseStrings.province;

export interface ProvinceSheetProps {
  visible: boolean;
  provinces: readonly Province[];
  /** Provincia activa. */
  selectedId: string | null;
  onSelect: (provinceId: string) => void;
  onClose: () => void;
  testID?: string;
}

/**
 * «Elige tu provincia»: las provincias disponibles con la activa marcada. Todo trayecto ocurre dentro de UNA provincia, por
 * eso se elige una sola (se recuerda entre sesiones).
 */
export function ProvinceSheet({ visible, provinces, selectedId, onSelect, onClose, testID = "ProvinceSheet" }: ProvinceSheetProps): React.JSX.Element | null {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={copy.sheetTitle} subtitle={copy.sheetSubtitle} testID={testID}>
      <View style={styles.list}>
        {provinces.map((province) => (
          <RadioRow
            key={province.id}
            label={province.name}
            selected={province.id === selectedId}
            onSelect={() => onSelect(province.id)}
            accessibilityLabel={province.id === selectedId ? `${province.name}. ${copy.selected}` : province.name}
            testID={`${testID}.option.${province.code}`}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, paddingTop: 6, paddingBottom: 8 },
});
