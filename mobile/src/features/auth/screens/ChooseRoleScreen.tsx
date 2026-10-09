import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { Role } from "@/api/types";
import { describeError } from "@/api/errors";
import { useApiMutation, useIsOnline } from "@/hooks";
import { Icon } from "@/icons";
import { applyGate, useAppNavigation, useAppRoute, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Banner, Button, Screen, ScreenHeader, Text } from "@/ui";
import { saveRoles } from "../api";
import { AuthButton } from "../components/AuthButton";
import { RoleCard } from "../components/RoleCard";
import { authPalette } from "../components/palette";
import { registrationDraft, useRegistrationDraft } from "../stores/registrationDraft";
import { authStrings } from "../strings";

const copy = authStrings.role;
const ROLE_ORDER: readonly Role[] = ["passenger", "driver"];

function orderRoles(roles: readonly string[]): Role[] {
  return ROLE_ORDER.filter((role) => roles.includes(role));
}

/**
 * 02 · Elige tu perfil. Dos tarjetas-casilla (pasajero, conductor; se pueden elegir las dos). En el alta se guarda la
 * elección en el borrador y se pasa a «Tu cuenta»; con sesión abierta pero sin perfil (cuenta nueva sin terminar) se
 * guarda con `PUT /v1/me/roles` y la navegación continúa donde toque (foto de perfil o inicio).
 */
export function ChooseRoleScreen(_props: AppScreenProps<"ChooseRole">): React.JSX.Element {
  const navigation = useAppNavigation();
  const route = useAppRoute("ChooseRole");
  const { status, roles: sessionRoles, refreshMe, signOut } = useAuth();
  const signedIn = status === "signedIn";
  const online = useIsOnline();
  const draft = useRegistrationDraft();
  const initialRole = route.params?.initialRole;

  const [selected, setSelected] = useState<Role[]>(() => {
    if (signedIn) return orderRoles(sessionRoles);
    if (draft.roles.length > 0) return orderRoles(draft.roles);
    return initialRole !== undefined ? [initialRole] : [];
  });
  const [triedEmpty, setTriedEmpty] = useState(false);
  const [incomplete, setIncomplete] = useState(false);

  const save = useApiMutation(
    async (variables: { roles: Role[] }, { idempotencyKey, signal }) => {
      const result = await saveRoles(variables.roles, { idempotencyKey, signal });
      await refreshMe();
      return result;
    },
    {
      onSuccess: () => {
        const decision = applyGate();
        setIncomplete(decision !== null && decision.reason === "onboarding_role");
      },
    },
  );

  const toggle = useCallback(
    (role: Role) => {
      setTriedEmpty(false);
      setIncomplete(false);
      setSelected((current) => (current.includes(role) ? current.filter((entry) => entry !== role) : orderRoles([...current, role])));
    },
    [],
  );

  const onContinue = useCallback(() => {
    if (selected.length === 0) {
      setTriedEmpty(true);
      return;
    }
    if (!signedIn) {
      registrationDraft.set({ roles: selected });
      navigation.navigate("CreateAccount", { roles: selected });
      return;
    }
    void save.mutate({ roles: selected });
  }, [navigation, save, selected, signedIn]);

  const failure = save.error !== null ? describeError(save.error) : null;
  const offlineSave = signedIn && !online;

  return (
    <Screen
      padded={false}
      testID="ChooseRole"
      header={<ScreenHeader variant="large" title={copy.title} subtitle={`${copy.subtitleTop}\n${copy.subtitleBottom}`} testID="ChooseRole.header" />}
      footer={
        <AuthButton
          label={copy.continue}
          onPress={onContinue}
          loading={save.isPending}
          style={styles.continueButton}
          accessibilityHint={signedIn ? undefined : authStrings.create.title}
          testID="ChooseRole.continue"
        />
      }
    >
      <View style={styles.cards}>
        <RoleCard
          role="passenger"
          selected={selected.includes("passenger")}
          invalid={triedEmpty}
          onPress={() => toggle("passenger")}
          testID="ChooseRole.passenger"
        />
        <RoleCard
          role="driver"
          selected={selected.includes("driver")}
          invalid={triedEmpty}
          onPress={() => toggle("driver")}
          style={styles.secondCard}
          testID="ChooseRole.driver"
        />
      </View>

      <View style={styles.infoRow} testID="ChooseRole.info">
        <View style={styles.infoDisc}>
          <Icon name="infoMark" size={22} color={colors.onPrimary} />
        </View>
        <Text variant="subtitle" color="muted" size={19} lineHeight={23.5} letterSpacing={0.3} style={styles.infoText}>
          {copy.info}
        </Text>
      </View>

      <View style={styles.messages} accessibilityLiveRegion="polite">
        {triedEmpty ? (
          <Text variant="rowTitle" color="error" testID="ChooseRole.pickError" accessibilityRole="alert">
            {copy.pickOne}
          </Text>
        ) : null}
        {offlineSave ? <Banner kind="notice" size="sm" message={copy.offlineSave} testID="ChooseRole.offline" /> : null}
        {failure !== null && save.isOffline === false ? (
          <Banner
            kind="error"
            size="sm"
            title={copy.saveFailedTitle}
            message={failure.message}
            actionLabel={authStrings.common.retry}
            onAction={() => void save.retry()}
            testID="ChooseRole.saveError"
          />
        ) : null}
        {save.isOffline ? (
          <Banner
            kind="notice"
            size="sm"
            message={copy.offlineSave}
            actionLabel={authStrings.common.retry}
            onAction={() => void save.retry()}
            testID="ChooseRole.saveOffline"
          />
        ) : null}
        {incomplete ? <Banner kind="warning" size="sm" message={copy.stillIncomplete} testID="ChooseRole.incomplete" /> : null}
      </View>

      {signedIn ? (
        <Button
          label={copy.switchAccount}
          variant="ghost"
          onPress={() => void signOut()}
          style={styles.switchAccount}
          testID="ChooseRole.switchAccount"
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cards: { paddingHorizontal: 11.5, paddingTop: 20 },
  secondCard: { marginTop: 7 },
  infoRow: { flexDirection: "row", alignItems: "center", paddingLeft: 31, paddingRight: 24, marginTop: 17 },
  infoDisc: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: authPalette.infoDisc,
    alignItems: "center",
    justifyContent: "center",
  },
  infoText: { flex: 1, marginLeft: 23.5 },
  messages: { paddingHorizontal: 18, marginTop: 10, gap: 10 },
  continueButton: { marginHorizontal: 18 },
  switchAccount: { marginTop: 8 },
});
