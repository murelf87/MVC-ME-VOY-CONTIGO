/** Hoja «¿Dónde bajas?» (15): paradas de bajada posibles tras el punto de recogida, con su hora de llegada. */
import React from "react";
import { OptionSheet } from "@/ui";
import type { DropoffOption } from "../logic/reviewModel";
import { requestStrings } from "../strings";

const copy = requestStrings.review;

export interface DropoffSheetProps {
  visible: boolean;
  options: readonly DropoffOption[];
  selectedSeq: number;
  onSelect: (seq: number) => void;
  onClose: () => void;
  testID?: string;
}

export function DropoffSheet({ visible, options, selectedSeq, onSelect, onClose, testID = "DropoffSheet" }: DropoffSheetProps): React.JSX.Element {
  return (
    <OptionSheet<string>
      visible={visible}
      title={copy.dropoffSheetTitle}
      options={options.map((o) => ({ value: String(o.seq), label: o.label, description: copy.dropoffArrives(o.time) }))}
      selected={String(selectedSeq)}
      onSelect={(value) => onSelect(Number(value))}
      onClose={onClose}
      testID={testID}
    />
  );
}
