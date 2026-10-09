import React, { useCallback, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { images } from "@/assets";
import { MvcLogo } from "@/brand";
import { useAppNavigation, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import { colors } from "@/theme";
import { Button, Dialog, Screen, Text } from "@/ui";
import { AuthButton } from "../components/AuthButton";
import { PagerDots } from "../components/PagerDots";
import { WelcomeSheetEdge } from "../components/WelcomeSheetEdge";
import { authPalette } from "../components/palette";
import { WELCOME_DESIGN, computeWelcomeLayout, welcomeBottomPad } from "../logic/welcomeLayout";
import { authStrings } from "../strings";

const copy = authStrings.welcome;
/** La lámina dibuja el punto final del lema como un disco verde aparte: el texto lleva solo las palabras. */
const headlineBottomWords = copy.headlineBottom.replace(/\.$/, "");

/**
 * 01 · Bienvenida. Ilustración de Sevilla con el logotipo, el lema y una hoja blanca con tres salidas: crear cuenta
 * (→ elegir perfil), entrar (→ móvil + código) y explorar sin registrarme (modo invitado: la navegación entra a MapHome).
 * Si la sesión se cerró sola (caducada o cuenta no activa) se explica en un aviso.
 */
export function WelcomeScreen(_props: AppScreenProps<"Welcome">): React.JSX.Element {
  const navigation = useAppNavigation();
  const { signOutReason, continueAsGuest } = useAuth();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [size, setSize] = useState({ width: window.width, height: window.height });
  const [noticeClosed, setNoticeClosed] = useState(false);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
  }, []);

  const bottomPad = welcomeBottomPad(insets.bottom);
  const layout = useMemo(
    () => computeWelcomeLayout({ width: size.width, height: size.height, insetTop: insets.top, bottomPad }),
    [size.width, size.height, insets.top, bottomPad],
  );

  const notice = !noticeClosed && (signOutReason === "expired" || signOutReason === "inactive") ? signOutReason : null;
  const goSignIn = (): void => {
    setNoticeClosed(true);
    navigation.navigate("SignIn");
  };

  const { headline, subtitle } = layout;
  return (
    <Screen scroll={false} padded={false} topInset={false} background={authPalette.welcomeSky} testID="Welcome">
      <View style={styles.root} onLayout={onLayout}>
        <View style={[styles.hero, { top: layout.heroTop, height: layout.heroHeight }]} pointerEvents="none">
          <Image
            source={images.hero.welcome.source}
            resizeMode="stretch"
            style={[styles.heroImage, { height: size.width * WELCOME_DESIGN.heroAspect }]}
            accessibilityIgnoresInvertColors
            accessible={false}
            testID="Welcome.hero"
          />
        </View>

        <View style={styles.overlay} pointerEvents="none">
          <MvcLogo
            variant="stacked"
            width={layout.logo.width}
            style={{ position: "absolute", left: layout.logo.left, top: layout.logo.top }}
            testID="Welcome.logo"
          />
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${copy.headlineTop} ${copy.headlineBottom}`}
            style={StyleSheet.absoluteFill}
          >
            <Text
              variant="display"
              color={colors.brand.navy}
              size={headline.fontSize}
              lineHeight={headline.lineHeight}
              style={[styles.abs, { left: headline.line1.left, top: headline.line1.top }]}
            >
              {copy.headlineTop}
            </Text>
            <Text
              variant="display"
              color={colors.brand.blue}
              size={headline.fontSize}
              lineHeight={headline.lineHeight}
              style={[styles.abs, { left: headline.line2.left, top: headline.line2.top }]}
            >
              {headlineBottomWords}
            </Text>
            <View
              style={[
                styles.abs,
                {
                  left: layout.dot.left,
                  top: layout.dot.top,
                  width: layout.dot.size,
                  height: layout.dot.size,
                  borderRadius: layout.dot.size / 2,
                  backgroundColor: colors.brand.green,
                },
              ]}
            />
          </View>
          <Text
            variant="subtitle"
            color="body"
            align="center"
            size={subtitle.fontSize}
            lineHeight={subtitle.lineHeight}
            letterSpacing={subtitle.letterSpacing}
            style={[styles.abs, { left: subtitle.left, top: subtitle.top, width: subtitle.width }]}
          >
            {copy.subtitle}
          </Text>
        </View>

        <View style={styles.sheet} testID="Welcome.sheet">
          <WelcomeSheetEdge width={size.width} />
          <View style={[styles.sheetBody, { paddingBottom: bottomPad }]}>
            <PagerDots
              count={authStrings.steps.total}
              active={0}
              accessibilityLabel={authStrings.steps.label(1, authStrings.steps.total)}
              testID="Welcome.dots"
              style={styles.dots}
            />
            <AuthButton
              label={copy.createAccount}
              style={styles.firstButton}
              onPress={() => navigation.navigate("ChooseRole")}
              testID="Welcome.createAccount"
            />
            <AuthButton
              label={copy.signIn}
              variant="outline"
              style={styles.secondButton}
              onPress={() => navigation.navigate("SignIn")}
              testID="Welcome.signIn"
            />
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={copy.explore}
              onPress={continueAsGuest}
              hitSlop={{ top: 14, bottom: 10, left: 24, right: 24 }}
              style={styles.link}
              testID="Welcome.explore"
            >
              <Text variant="lead" color="link" underline size={21} lineHeight={20} letterSpacing={0.16}>
                {copy.explore}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <Dialog
        visible={notice !== null}
        onClose={() => setNoticeClosed(true)}
        icon="exclaim"
        iconTone={notice === "inactive" ? "solidRed" : "solidAmber"}
        title={notice === "inactive" ? copy.inactiveTitle : copy.sessionExpiredTitle}
        message={notice === "inactive" ? copy.inactive : copy.sessionExpired}
        testID="Welcome.notice"
        actions={
          <>
            {notice === "expired" ? <Button label={copy.signIn} onPress={goSignIn} testID="Welcome.notice.signIn" /> : null}
            <Button
              label={authStrings.common.close}
              variant={notice === "expired" ? "outline" : "primary"}
              chevron={false}
              onPress={() => setNoticeClosed(true)}
              testID="Welcome.notice.close"
              style={notice === "expired" ? styles.noticeSecond : undefined}
            />
          </>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: authPalette.welcomeSky },
  hero: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  /** Ancho completo y alto natural, pegada al borde inferior: equivale a «cover» anclado abajo (se recorta el cielo de arriba). */
  heroImage: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%" },
  overlay: StyleSheet.absoluteFill,
  abs: { position: "absolute" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0 },
  sheetBody: {
    backgroundColor: colors.bg.screen,
    paddingHorizontal: 21,
    paddingTop: 9.6,
  },
  dots: { alignSelf: "center", marginLeft: -3 },
  firstButton: { marginTop: 15.25 },
  secondButton: { marginTop: 6.5 },
  link: { alignSelf: "center", marginTop: 10.5, minHeight: 21 },
  noticeSecond: { marginTop: 10 },
});

