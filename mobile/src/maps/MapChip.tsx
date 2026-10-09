/**
 * Chip del mapa: tarjeta blanca con sombra suave («2 plazas», «Ana / llega en 8 min», «1. Palomares del Río / Origen / 07:00 ≡»).
 * Tamaño EXACTO calculado con métricas de Roboto Condensed (`measureChip`) para que el anclaje de los marcadores sea
 * idéntico en iOS, Android y web. Se puede usar suelto en cualquier pantalla (p. ej. como tarjeta de parada).
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { CHIP_GAP, CHIP_HANDLE_GAP_AFTER, CHIP_HANDLE_GAP_BEFORE, CHIP_HANDLE_W, CHIP_LINE_GAP, measureChip } from './chipLayout';
import { CapGlyph, ClockGlyph, CarGlyph, HandleGlyph, WalkGlyph } from './glyphs';
import { MAP_FONTS } from './mapFonts';
import { chipToneColor, MAP_COLORS, MAP_SHADOWS } from './mapTheme';
import type { ChipTone, MapChipSpec } from './types';

export interface MapChipProps extends MapChipSpec {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function iconFor(icon: NonNullable<MapChipSpec['icon']>, color: string): React.JSX.Element {
  switch (icon) {
    case 'walk':
      return <WalkGlyph width={15} color={color} />;
    case 'car':
      return <CarGlyph width={21} color={color} cut={MAP_COLORS.white} />;
    case 'cap':
      return <CapGlyph width={22} color={color} />;
    case 'clock':
      return <ClockGlyph width={18} color={color} />;
  }
}

export function MapChip(props: MapChipProps): React.JSX.Element {
  const { title, subtitle, trailing, icon, handle, style, testID } = props;
  const tone: ChipTone = props.tone ?? 'brand';
  const subtitleTone: ChipTone = props.subtitleTone ?? (tone === 'neutral' ? 'muted' : tone === 'brand' ? 'neutral' : tone);
  const layout = measureChip(props);
  const m = layout.metrics;
  const textAlign = props.align === 'center' ? 'center' : 'left';
  const titleColor = chipToneColor(tone);
  const subColor = chipToneColor(subtitleTone);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={[title.replace(/\n/g, ' '), subtitle?.replace(/\n/g, ' '), trailing].filter(Boolean).join(', ')}
      style={[styles.chip, { width: layout.width, height: layout.height, paddingHorizontal: m.padX, borderRadius: m.radius }, style]}
    >
      {icon ? <View style={[styles.icon, { width: layout.iconBlock }]}>{iconFor(icon, titleColor)}</View> : null}
      <View style={{ width: layout.textBlock }}>
        {layout.titleLines.map((line, i) => (
          <Text
            key={`t${i}`}
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.title, props.titleWeight === 'medium' ? styles.titleMedium : null, { fontSize: m.title, lineHeight: m.titleLine, color: titleColor, textAlign }]}
          >
            {line}
          </Text>
        ))}
        {layout.trailingInline && trailing ? (
          <View style={[styles.inlineRow, { marginTop: CHIP_LINE_GAP }]}>
            <Text allowFontScaling={false} numberOfLines={1} style={[styles.subtitle, { fontSize: m.subtitle, lineHeight: m.subtitleLine, color: subColor }]}>
              {layout.subtitleLines[0]}
            </Text>
            <Text allowFontScaling={false} numberOfLines={1} style={[styles.trailing, { fontSize: m.trailing, lineHeight: m.subtitleLine, color: titleColor }]}>
              {trailing}
            </Text>
          </View>
        ) : (
          layout.subtitleLines.map((line, i) => (
            <Text
              key={`s${i}`}
              allowFontScaling={false}
              numberOfLines={1}
              style={[styles.subtitle, { fontSize: m.subtitle, lineHeight: m.subtitleLine, marginTop: i === 0 ? CHIP_LINE_GAP : 0, color: subColor, textAlign }]}
            >
              {line}
            </Text>
          ))
        )}
      </View>
      {trailing && !layout.trailingInline ? (
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[styles.trailing, { fontSize: m.trailing, lineHeight: m.titleLine, color: titleColor, marginLeft: CHIP_GAP, width: layout.trailingText }]}
        >
          {trailing}
        </Text>
      ) : null}
      {handle ? (
        <>
          <View style={[styles.divider, { marginLeft: CHIP_HANDLE_GAP_BEFORE, marginRight: CHIP_HANDLE_GAP_AFTER }]} />
          <View style={{ width: CHIP_HANDLE_W }}>
            <HandleGlyph width={CHIP_HANDLE_W} color="#8A92AD" />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: MAP_COLORS.white,
    boxShadow: MAP_SHADOWS.chip,
  },
  icon: { justifyContent: 'center' },
  title: { fontFamily: MAP_FONTS.bold, includeFontPadding: false },
  titleMedium: { fontFamily: MAP_FONTS.medium },
  subtitle: { fontFamily: MAP_FONTS.medium, includeFontPadding: false },
  trailing: { fontFamily: MAP_FONTS.medium, includeFontPadding: false },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: '#D6DAE8' },
  inlineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
});
