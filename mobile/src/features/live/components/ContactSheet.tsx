import React from "react";
import { StyleSheet, View } from "react-native";
import { IconTile } from "@/icons";
import { BottomSheet, Banner, ListRow, Spinner } from "@/ui";
import type { ContactDriverController } from "../hooks/useContactDriver";
import { liveStrings } from "../strings";

const copy = liveStrings.contact;

export interface ContactSheetProps {
  visible: boolean;
  onClose: () => void;
  driverName: string;
  controller: ContactDriverController;
  testID?: string;
}

/** «Contactar con Ana»: escribir (chat de la reserva) o llamar (solo dentro de la ventana del viaje). */
export function ContactSheet({ visible, onClose, driverName, controller, testID }: ContactSheetProps): React.JSX.Element {
  const { busy, notice } = controller;
  const id = (suffix: string): string | undefined => (testID !== undefined ? `${testID}.${suffix}` : undefined);

  const write = async (): Promise<void> => {
    if (await controller.openChat()) onClose();
  };
  const call = async (): Promise<void> => {
    if (await controller.call()) onClose();
  };

  const close = (): void => {
    controller.clearNotice();
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={copy.title(driverName)} subtitle={copy.message} testID={testID}>
      <View style={styles.rows}>
        <ListRow
          title={copy.writeTitle}
          subtitle={copy.writeSubtitle}
          leading={<IconTile name="chatText" tone="blue" size={44} iconSize={24} />}
          trailing={busy === "chat" ? <Spinner size="sm" /> : "chevron"}
          disabled={busy !== null}
          onPress={() => void write()}
          testID={id("chat")}
        />
        <ListRow
          title={copy.callTitle(driverName)}
          subtitle={copy.callSubtitle}
          leading={<IconTile name="phone" tone="green" size={44} iconSize={24} />}
          trailing={busy === "call" ? <Spinner size="sm" /> : "chevron"}
          disabled={busy !== null}
          onPress={() => void call()}
          testID={id("call")}
        />
        {notice !== null ? (
          <Banner
            kind={notice.tone === "error" ? "error" : notice.tone === "warning" ? "notice" : "info"}
            size="sm"
            message={notice.message}
            testID={id("notice")}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 10, paddingBottom: 6 },
});
