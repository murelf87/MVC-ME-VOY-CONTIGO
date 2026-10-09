/**
 * Leyenda del mapa. Dos formas, ambas de las láminas:
 *  - `card`:   tarjeta blanca sobre el mapa con iconos y etiquetas («Ruta del conductor» / «Trayecto a pie desde el punto», lámina 13).
 *  - `footer`: fila bajo el mapa con punto + etiqueta a la izquierda y la nota «Mapa ilustrativo ⓘ» a la derecha (lámina 37).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { CarGlyph, InfoGlyph, WalkGlyph } from './glyphs';
import { MAP_FONTS } from './mapFonts';
import { MAP_COLORS, MAP_SHADOWS } from './mapTheme';

export interface MapLegendItem {
  /** Icono: `car` (coche azul), `walk` (puntos + peatón), `dot` (punto de color). */
  icon: 'car' | 'walk' | 'dot';
  label: string;
  /** Color del punto (solo `dot`). */
  color?: string;
}

export interface MapLegendProps {
  items?: readonly MapLegendItem[];
  variant?: 'card' | 'footer';
  /** Nota a la derecha en la variante `footer` («Mapa ilustrativo»). */
  note?: string;
  onNotePress?: () => void;
  /** Colocación absoluta cuando se usa como hijo de `MvcMap` (con `edgePadding` de la pantalla se puede ajustar con `style`). */
  position?: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function ItemIcon({ item }: { item: MapLegendItem }): React.JSX.Element {
  switch (item.icon) {
    case 'car':
      return <CarGlyph width={22} color={MAP_COLORS.pin} cut={MAP_COLORS.white} />;
    case 'walk':
      return (
        <View style={styles.walkIcon}>
          <View style={styles.dot} />
          <View style={styles.dot} />
          <WalkGlyph width={12} color={MAP_COLORS.pin} />
        </View>
      );
    case 'dot':
      return <View style={[styles.legendDot, { backgroundColor: item.color ?? MAP_COLORS.brand }]} />;
  }
}

export function MapLegend({ items = [], variant = 'card', note, onNotePress, position, style, testID = 'MapLegend' }: MapLegendProps): React.JSX.Element {
  const placement: ViewStyle | undefined =
    position === 'topLeft' ? { position: 'absolute', top: 10, left: 10 }
    : position === 'topRight' ? { position: 'absolute', top: 10, right: 10 }
    : position === 'bottomLeft' ? { position: 'absolute', bottom: 10, left: 10 }
    : position === 'bottomRight' ? { position: 'absolute', bottom: 10, right: 10 }
    : undefined;

  if (variant === 'footer') {
    return (
      <View testID={testID} style={[styles.footer, placement, style]}>
        <View style={styles.footerItems}>
          {items.map((item) => (
            <View key={item.label} style={styles.footerItem}>
              <ItemIcon item={item} />
              <Text allowFontScaling={false} style={styles.footerLabel}>
                {item.label}
              </Text>
            </View>
          ))}
        </View>
        {note ? (
          <Pressable
            onPress={onNotePress}
            disabled={!onNotePress}
            accessibilityRole={onNotePress ? 'button' : 'text'}
            accessibilityLabel={`${note}. Más información`}
            testID={`${testID}.note`}
            style={styles.note}
          >
            <Text allowFontScaling={false} style={styles.noteText}>
              {note}
            </Text>
            <InfoGlyph width={22} color="#3B4262" cut={MAP_COLORS.white} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View testID={testID} accessibilityRole="summary" style={[styles.card, placement, style]}>
      {items.map((item) => (
        <View key={item.label} style={styles.cardRow}>
          <View style={styles.cardIcon}>
            <ItemIcon item={item} />
          </View>
          <Text allowFontScaling={false} style={styles.cardLabel}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: MAP_COLORS.white,
    gap: 3,
    boxShadow: MAP_SHADOWS.legend,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 28, alignItems: 'center' },
  cardLabel: { fontFamily: MAP_FONTS.medium, fontSize: 15, lineHeight: 20, color: MAP_COLORS.chipTitle, includeFontPadding: false },
  walkIcon: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dot: { width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: MAP_COLORS.pin },
  legendDot: { width: 16, height: 16, borderRadius: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  footerItems: { flexDirection: 'row', alignItems: 'center', gap: 14, flexShrink: 1 },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerLabel: { fontFamily: MAP_FONTS.regular, fontSize: 15, lineHeight: 20, color: '#2B3FC8', includeFontPadding: false },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 4 },
  noteText: { fontFamily: MAP_FONTS.regular, fontSize: 15, lineHeight: 20, color: '#3D4DB7', includeFontPadding: false },
});
