import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { LocateGlyph } from './glyphs';
import { MAP_COLORS, MAP_SHADOWS } from './mapTheme';

export interface RecenterButtonProps {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

/** Botón redondo blanco «centrar en mi ubicación» (esquina inferior derecha del mapa en las láminas 09 y 13). */
export function RecenterButton({ onPress, style, testID = 'MvcMap.recenter', accessibilityLabel = 'Centrar en mi ubicación' }: RecenterButtonProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null, style]}
    >
      <LocateGlyph width={26} color={MAP_COLORS.locateIcon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MAP_COLORS.white,
    boxShadow: MAP_SHADOWS.button,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
});
