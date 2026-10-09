import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { startPhoneVerification, verifyPhoneCode } from "@/api";
import { describeError } from "@/api/errors";
import { useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { applyGate, useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Banner, Button, Card, OfflineBanner, OtpInput, Screen, ScreenHeader, Text, showToast } from "@/ui";
import { AuthButton } from "../components/AuthButton";
import { useResendCountdown } from "../hooks/useResendCountdown";
import { maskPhone } from "../logic/format";
import { classifyStartError, classifyVerifyError, isCompleteCode, sanitizeCode, type VerifyFailure } from "../logic/otp";
import { completeSignup, isRegistration, type SignupFailure, type SignupStep } from "../services/completeSignup";
import { registrationDraft } from "../stores/registrationDraft";
import { authStrings } from "../strings";

const copy = authStrings.verify;

type Phase = "idle" | "checking" | "saving";

/**
 * 04 · Confirma tu móvil. Código SMS de 6 dígitos, cuenta atrás para reenviar y «Cambiar número de móvil».
 * «Verificar» comprueba el código (`POST /v1/auth/phone/verify`), abre la sesión y, si viene del alta, termina de guardar
 * nombre, perfil, aceptación legal y foto. Si algún paso falla se ofrece «Reintentar» o «Entrar ahora».
 */
export function VerifyPhoneScreen(_props: AppScreenProps<"VerifyPhone">): React.JSX.Element {
  const navigation = useAppNavigation();
  const route = useAppRoute("VerifyPhone");
  const { signIn } = useAuth();
  const online = useIsOnline();
  const params = route.params;

  const [challenge, setChallenge] = useState({ challengeId: params.challengeId, expiresAt: params.expiresAt });
  const [code, setCode] = useState("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [failure, setFailure] = useState<VerifyFailure | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<SignupFailure | null>(null);
  const [savingStep, setSavingStep] = useState<SignupStep | null>(null);

  const tokenRef = useRef<string | null>(null);
  const doneRef = useRef<Set<SignupStep>>(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const countdown = useResendCountdown(challenge.expiresAt);
  const busy = phase !== "idle";

  const finish = useCallback(() => {
    registrationDraft.reset();
    applyGate();
  }, []);

  const runFollowUp = useCallback(async () => {
    const token = tokenRef.current;
    if (token === null) return;
    const draft = registrationDraft.get();
    if (!isRegistration(draft)) {
      finish();
      return;
    }
    setPhase("saving");
    setFollowUp(null);
    const result = await completeSignup({ token, draft, done: doneRef.current, onStep: (step) => mounted.current && setSavingStep(step) });
    if (!mounted.current) return;
    setSavingStep(null);
    if (result === null) {
      finish();
      return;
    }
    setFollowUp(result);
    setPhase("idle");
  }, [finish]);

  const verify = useCallback(
    async (candidate: string) => {
      if (busy || !isCompleteCode(candidate)) return;
      setFailure(null);
      setPhase("checking");
      try {
        const session = await verifyPhoneCode({ challengeId: challenge.challengeId, code: candidate });
        tokenRef.current = session.token;
        await signIn({ token: session.token });
        if (!mounted.current) return;
        await runFollowUp();
      } catch (error) {
        if (!mounted.current) return;
        const attempts = failedAttempts + 1;
        const classified = classifyVerifyError(error, { expiresAtIso: challenge.expiresAt, nowMs: Date.now(), failedAttempts: attempts });
        if (classified.kind === "wrong_code") setFailedAttempts(attempts);
        if (classified.needsNewCode) setCode("");
        setFailure(classified);
        setPhase("idle");
      }
    },
    [busy, challenge, failedAttempts, runFollowUp, signIn],
  );

  const resend = useCallback(async () => {
    if (resending || !countdown.ready) return;
    setResending(true);
    setResendError(null);
    try {
      const next = await startPhoneVerification({ phone: params.phoneE164, ...(params.roles !== undefined ? { roles: params.roles } : {}) });
      if (!mounted.current) return;
      setChallenge({ challengeId: next.challengeId, expiresAt: next.expiresAt });
      registrationDraft.set({ lastChallenge: { phoneE164: params.phoneE164, challengeId: next.challengeId, expiresAt: next.expiresAt } });
      setCode("");
      setFailure(null);
      setFailedAttempts(0);
      showToast(copy.resentToast);
    } catch (error) {
      if (mounted.current) setResendError(classifyStartError(error).message);
    } finally {
      if (mounted.current) setResending(false);
    }
  }, [countdown.ready, params.phoneE164, params.roles, resending]);

  const changePhone = useCallback(() => {
    registrationDraft.set({ lastChallenge: null });
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("CreateAccount", params.roles !== undefined ? { roles: params.roles } : undefined);
  }, [navigation, params.roles]);

  const showExpired = countdown.expired && failure === null;
  const message = failure?.message ?? (showExpired ? copy.expiredCode : null);
  const needsNewCode = failure?.needsNewCode === true || showExpired;
  const progress = phase === "checking" ? copy.verifying : phase === "saving" ? (savingStep === "photo" ? copy.finishing : copy.creatingAccount) : null;
  const followUpFailure = followUp !== null ? describeError(followUp.error).message : null;

  return (
    <Screen
      padded={false}
      testID="VerifyPhone"
      header={<ScreenHeader variant="large" title={copy.title} testID="VerifyPhone.header" onBack={phase === "saving" ? () => undefined : undefined} />}
      footer={
        followUp !== null ? undefined : (
          <AuthButton
            label={copy.verify}
            onPress={() => void verify(code)}
            disabled={!isCompleteCode(code) || needsNewCode || !online}
            loading={busy}
            style={styles.verify}
            testID="VerifyPhone.verify"
          />
        )
      }
    >
      {!online ? <OfflineBanner testID="VerifyPhone.offline" /> : null}

      <View style={styles.sent}>
        <Text variant="subtitle" color="muted" align="center" size={20.5} lineHeight={27}>
          {copy.sentTo}
        </Text>
        <Text variant="title" color="heading" align="center" size={26} lineHeight={34} style={styles.phone} testID="VerifyPhone.phone">
          {maskPhone(params.phoneE164)}
        </Text>
      </View>

      <View style={styles.code}>
        <OtpInput
          value={code}
          onChange={(next) => {
            setCode(sanitizeCode(next));
            if (failure !== null && failure.kind === "wrong_code") setFailure(null);
          }}
          onComplete={(complete) => void verify(complete)}
          error={failure?.kind === "wrong_code"}
          disabled={busy || needsNewCode || followUp !== null}
          autoFocus
          accessibilityLabel={copy.codeLabel}
          testID="VerifyPhone.code"
        />
      </View>

      <View style={styles.messages} accessibilityLiveRegion="polite">
        {message !== null ? (
          <Banner
            kind="error"
            size="md"
            message={message}
            testID="VerifyPhone.error"
          />
        ) : null}
        {failure?.kind === "wrong_code" && failure.attemptsLeft !== null && failure.attemptsLeft <= 2 ? (
          <Text variant="caption" color="muted" align="center" testID="VerifyPhone.attempts">
            {copy.attemptsLeft(failure.attemptsLeft)}
          </Text>
        ) : null}
        {failure !== null && failure.retryable ? (
          <Banner
            kind="notice"
            size="sm"
            message={failure.message}
            actionLabel={authStrings.common.retry}
            onAction={() => void verify(code)}
            testID="VerifyPhone.retryable"
          />
        ) : null}
        {progress !== null ? (
          <Text variant="subtitle" color="muted" align="center" testID="VerifyPhone.progress">
            {progress}
          </Text>
        ) : null}
        {followUp !== null ? (
          <View style={styles.followUp} testID="VerifyPhone.followUp">
            <Banner kind="warning" size="sm" title={copy.followUpFailedTitle} message={`${copy.followUpFailed}${followUpFailure !== null ? `\n${followUpFailure}` : ""}`} />
            <AuthButton label={copy.retrySave} onPress={() => void runFollowUp()} testID="VerifyPhone.retrySave" />
            <AuthButton label={copy.enterAnyway} variant="outline" onPress={finish} testID="VerifyPhone.enterAnyway" />
          </View>
        ) : null}
      </View>

      <Card tone="blue" padding={0} radius={20} style={styles.timer} testID="VerifyPhone.timer">
        <View style={styles.timerIcon}>
          <Icon name="clockFilled" size={46} color={colors.primary} />
        </View>
        <View style={styles.timerText}>
          <Text variant="subtitle" color="muted" size={19.5} lineHeight={24}>
            {countdown.ready ? copy.resendReady : copy.resendIn}
          </Text>
          {countdown.ready ? null : (
            <Text variant="title" color="heading" size={32} lineHeight={38} testID="VerifyPhone.clock">
              {countdown.clock}
            </Text>
          )}
        </View>
      </Card>

      <View style={styles.links}>
        <Button
          label={copy.resend}
          variant="link"
          onPress={() => void resend()}
          disabled={!countdown.ready || resending || busy || !online}
          loading={resending}
          accessibilityHint={countdown.ready ? undefined : copy.resendWait(countdown.clock)}
          testID="VerifyPhone.resend"
        />
        {resendError !== null ? (
          <Text variant="caption" color="error" align="center" accessibilityRole="alert" testID="VerifyPhone.resendError">
            {resendError}
          </Text>
        ) : null}
        <View style={styles.or}>
          <View style={styles.rule} />
          <Text variant="body" color="heading" size={19} style={styles.orText}>
            {copy.or}
          </Text>
          <View style={styles.rule} />
        </View>
        <Button label={copy.changePhone} variant="link" onPress={changePhone} disabled={phase === "saving"} testID="VerifyPhone.changePhone" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sent: { paddingHorizontal: 20, paddingTop: 10 },
  phone: { marginTop: 14 },
  code: { paddingHorizontal: 12, marginTop: 32 },
  messages: { paddingHorizontal: 12, marginTop: 22, gap: 10 },
  followUp: { gap: 10 },
  timer: { marginHorizontal: 12, marginTop: 18, flexDirection: "row", alignItems: "center", minHeight: 100 },
  timerIcon: { width: 112, alignItems: "center" },
  timerText: { flex: 1, paddingRight: 12 },
  links: { paddingHorizontal: 18, marginTop: 16, alignItems: "center", gap: 6 },
  or: { flexDirection: "row", alignItems: "center", alignSelf: "stretch", marginVertical: 18 },
  rule: { flex: 1, height: 1.5, backgroundColor: colors.border.default },
  orText: { marginHorizontal: 22 },
  verify: { marginHorizontal: 20 },
});
