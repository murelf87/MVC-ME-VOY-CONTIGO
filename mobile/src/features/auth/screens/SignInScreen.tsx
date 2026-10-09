import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { normalizePhoneE164 } from "@/api/phone";
import { startPhoneVerification } from "@/api";
import { useApiMutation, useIsOnline } from "@/hooks";
import { useAppNavigation, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Banner, OfflineBanner, PhoneField, Screen, ScreenHeader, Text } from "@/ui";
import { AuthButton } from "../components/AuthButton";
import { classifyStartError } from "../logic/otp";
import { phoneError } from "../logic/registration";
import { registrationDraft } from "../stores/registrationDraft";
import { authStrings } from "../strings";

const copy = authStrings.signIn;

/**
 * Entrar con una cuenta existente: móvil español → SMS (`POST /v1/auth/phone/start`) → «Confirma tu móvil». Si el
 * número aún no tiene cuenta, el flujo de verificación lo lleva al alta (la nota lo avisa). Mismo lenguaje visual que
 * 03: cabecera grande, campo de móvil, botón grande y alternativas debajo.
 */
export function SignInScreen(_props: AppScreenProps<"SignIn">): React.JSX.Element {
  const navigation = useAppNavigation();
  const online = useIsOnline();
  const { continueAsGuest } = useAuth();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const send = useApiMutation(async (variables: { phoneE164: string }, { signal }) => startPhoneVerification({ phone: variables.phoneE164 }, { signal }), {
    onSuccess: (data, variables) => {
      // Entrar no es un alta: se descarta cualquier borrador de registro antiguo para no crear la cuenta con sus datos.
      registrationDraft.reset();
      navigation.navigate("VerifyPhone", { challengeId: data.challengeId, phoneE164: variables.phoneE164, expiresAt: data.expiresAt });
    },
  });

  const submit = useCallback(() => {
    const problem = phoneError(phone);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    const parsed = normalizePhoneE164(phone);
    if (!parsed.ok) return;
    setError(undefined);
    void send.mutate({ phoneE164: parsed.e164 });
  }, [phone, send]);

  const failure = send.error !== null ? classifyStartError(send.error) : null;

  return (
    <Screen
      testID="SignIn"
      padded={false}
      header={<ScreenHeader variant="large" title={copy.title} subtitle={copy.subtitle} testID="SignIn.header" />}
      footer={<AuthButton label={copy.submit} onPress={submit} loading={send.isPending} disabled={!online} testID="SignIn.submit" style={styles.footer} />}
    >
      {!online ? <OfflineBanner testID="SignIn.offline" /> : null}
      <View style={styles.form}>
        <PhoneField
          label={copy.phone}
          value={phone}
          onChangeText={(text) => {
            setPhone(text);
            if (error !== undefined) setError(undefined);
          }}
          maxLength={16}
          returnKeyType="done"
          onSubmitEditing={submit}
          error={error}
          testID="SignIn.phone"
        />
        {failure !== null && !send.isOffline ? (
          <Banner
            kind="error"
            size="sm"
            title={failure.title}
            message={failure.message}
            actionLabel={failure.retryable ? authStrings.common.retry : undefined}
            onAction={failure.retryable ? () => void send.retry() : undefined}
            testID="SignIn.error"
          />
        ) : null}
        <Text variant="caption" color="muted" align="center" style={styles.note}>
          {copy.note}
        </Text>
      </View>

      <View style={styles.divider}>
        <View style={styles.line} />
        <Text variant="subtitle" color="muted">{copy.or}</Text>
        <View style={styles.line} />
      </View>

      <View style={styles.alt}>
        <AuthButton label={copy.createAccount} variant="outline" onPress={() => navigation.navigate("ChooseRole", undefined)} testID="SignIn.createAccount" />
        <Pressable accessibilityRole="button" accessibilityLabel={copy.explore} onPress={() => void continueAsGuest()} hitSlop={8} style={styles.explore} testID="SignIn.explore">
          <Text variant="subtitle" color="link" underline weight="medium" size={19}>
            {copy.explore}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { paddingHorizontal: 16, paddingTop: 20, gap: 14 },
  note: { paddingHorizontal: 12 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, marginTop: 22 },
  line: { flex: 1, height: 1, backgroundColor: colors.border.default },
  alt: { paddingHorizontal: 16, marginTop: 18, gap: 8 },
  explore: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  footer: { marginHorizontal: 16 },
});
