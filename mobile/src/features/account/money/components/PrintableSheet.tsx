/**
 * Versión imprimible del justificante. En web (y en la vista previa) se muestra el documento HTML del servidor aislado en
 * un `iframe` sin scripts; «Imprimir» abre el diálogo de impresión del navegador. En móvil no hay visor HTML nativo en la
 * app, así que se muestra el texto del documento y «Imprimir» abre la hoja de compartir del sistema (desde ahí se puede
 * imprimir o guardar como PDF).
 */
import React, { useRef } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { shareContent } from "@/platform";
import { BottomSheet, Button, Text } from "@/ui";
import { LoadError } from "./StateBlocks";
import { moneyStrings } from "../strings";

const t = moneyStrings.receipt;

/** Texto legible de un documento HTML (sin etiquetas, estilos ni scripts). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6]|li|section|article|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " · ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface PrintableSheetProps {
  visible: boolean;
  html: string | null;
  loading: boolean;
  error: unknown;
  subject: string;
  onRetry: () => void;
  onClose: () => void;
}

export function PrintableSheet({ visible, html, loading, error, subject, onRetry, onClose }: PrintableSheetProps): React.JSX.Element {
  const frame = useRef<unknown>(null);
  const isWeb = Platform.OS === "web";
  const print = (): void => {
    if (isWeb) {
      const el = frame.current as { contentWindow?: { focus: () => void; print: () => void } } | null;
      try {
        el?.contentWindow?.focus();
        el?.contentWindow?.print();
        return;
      } catch {
        // cae a compartir
      }
    }
    if (html !== null) void shareContent({ title: subject, message: htmlToText(html) });
  };
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t.printableTitle}
      testID="ReceiptDetail.printable"
      footer={
        <View style={styles.footer}>
          <Button testID="ReceiptDetail.printable.print" label={t.print} chevron={false} disabled={html === null} onPress={print} style={styles.gap} />
          <Button testID="ReceiptDetail.printable.close" label={t.printableClose} variant="outline" chevron={false} onPress={onClose} />
        </View>
      }
    >
      {loading && html === null ? <Text variant="body" color="muted" size={16} testID="ReceiptDetail.printable.loading" accessibilityLiveRegion="polite">{t.printableLoading}</Text> : null}
      {html === null && error !== null && error !== undefined && !loading ? <LoadError testID="ReceiptDetail.printable.error" heading={t.printableError} error={error} onRetry={onRetry} /> : null}
      {html !== null ? (
        isWeb ? (
          React.createElement("iframe", {
            ref: (node: unknown) => {
              frame.current = node;
            },
            title: t.printableTitle,
            srcDoc: html,
            sandbox: "allow-modals allow-same-origin",
            "data-testid": "ReceiptDetail.printable.frame",
            style: { width: "100%", height: 420, border: "1px solid #D5DEEA", borderRadius: 12, background: "#fff" },
          })
        ) : (
          <ScrollView style={styles.scroll} testID="ReceiptDetail.printable.text">
            <Text variant="body" color="body" size={15} selectable>{htmlToText(html)}</Text>
          </ScrollView>
        )
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { paddingTop: 4 },
  gap: { marginBottom: 10 },
  scroll: { maxHeight: 420 },
});
