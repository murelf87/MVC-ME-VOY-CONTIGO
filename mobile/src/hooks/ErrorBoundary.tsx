/**
 * Barrera de errores de render. Un fallo en una pantalla (de cualquier slice) no debe dejar la app en blanco:
 * se muestra un estado de error con «Reintentar» (y «Volver» si se indica) y el resto de la app sigue viva.
 *
 *   <ErrorBoundary resetKeys={[route.key]} onBack={navigation.goBack}> …pantalla… </ErrorBoundary>
 *
 * El aviso por defecto es mínimo a propósito (no depende del sistema de diseño, que es lo que podría haber fallado).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme/colors";

export interface ErrorFallbackProps {
  error: Error;
  /** Vuelve a pintar los hijos. */
  reset(): void;
  onBack?: () => void;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Sustituye al aviso por defecto. */
  fallback?: (props: ErrorFallbackProps) => ReactNode;
  /** Para registrar el error (el aviso por defecto no lo envía a ningún sitio). */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Si cambia cualquiera de estos valores, la barrera se reinicia sola (p. ej. al cambiar de ruta). */
  resetKeys?: readonly unknown[];
  /** Muestra el botón «Volver» en el aviso por defecto. */
  onBack?: () => void;
  testID?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function sameKeys(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && !sameKeys(previous.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback, onBack, testID } = this.props;
    if (fallback) return fallback({ error, reset: this.reset, ...(onBack ? { onBack } : {}) });
    return <DefaultErrorFallback error={error} reset={this.reset} {...(onBack ? { onBack } : {})} testID={testID ?? "ErrorBoundary"} />;
  }
}

function DefaultErrorFallback({ reset, onBack, testID }: ErrorFallbackProps & { testID: string }): ReactNode {
  return (
    <View style={styles.container} testID={testID} accessibilityRole="alert">
      <Text style={styles.title} accessibilityRole="header">
        Algo ha ido mal
      </Text>
      <Text style={styles.message}>Ha ocurrido un error inesperado en esta pantalla. Puedes volver a intentarlo.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Reintentar" onPress={reset} style={styles.primary} testID={`${testID}.retry`}>
        <Text style={styles.primaryLabel}>Reintentar</Text>
      </Pressable>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={onBack} style={styles.secondary} testID={`${testID}.back`}>
          <Text style={styles.secondaryLabel}>Volver</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: colors.bg.screen,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.heading, textAlign: "center", marginBottom: 8 },
  message: { fontSize: 15, lineHeight: 22, color: colors.text.muted, textAlign: "center", marginBottom: 24 },
  primary: {
    minHeight: 48,
    minWidth: 200,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
  },
  primaryLabel: { fontSize: 16, fontWeight: "700", color: colors.onPrimary },
  secondary: { minHeight: 48, minWidth: 200, alignItems: "center", justifyContent: "center", marginTop: 8 },
  secondaryLabel: { fontSize: 16, fontWeight: "600", color: colors.primary },
});
