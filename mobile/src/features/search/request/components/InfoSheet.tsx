/** Hoja informativa con un único botón de cierre («¿Qué es la gestión MVC?»…). */
import React from "react";
import { BottomSheet, Button, Text } from "@/ui";

export interface InfoSheetProps {
  visible: boolean;
  title: string;
  message: string;
  closeLabel: string;
  onClose: () => void;
  testID?: string;
}

export function InfoSheet({ visible, title, message, closeLabel, onClose, testID = "InfoSheet" }: InfoSheetProps): React.JSX.Element {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      testID={testID}
      footer={<Button label={closeLabel} chevron={false} onPress={onClose} testID={`${testID}.close`} />}
    >
      <Text variant="body" color="body" size={17.5} lineHeight={23}>
        {message}
      </Text>
    </BottomSheet>
  );
}
