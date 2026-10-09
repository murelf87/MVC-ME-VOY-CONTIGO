import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { TripCategory } from "@/api/types";
import { strings } from "@/i18n";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { SelectField, Text, tripCategoryIcon, tripCategoryOrder } from "@/ui";
import { browseStrings } from "../strings";

const copy = browseStrings.mapHome;

export type MapRole = "seeking" | "offering";

export interface MapControlsProps {
  /** Nombre de la provincia activa; `null` mientras se cargan. */
  provinceName: string | null;
  onProvince: () => void;
  role: MapRole;
  onRole: (role: MapRole) => void;
  category: TripCategory | null;
  onCategory: (category: TripCategory) => void;
  /** «Con plazas» / «Solo con plazas». */
  filterLabel: string;
  filterActive: boolean;
  onFilter: () => void;
  onSearch: () => void;
}

/**
 * Los controles de la lámina 09 sobre el mapa: provincia, «Busco coche | Ofrezco plazas», categorías, buscador y filtro.
 * Es presentacional: todo lo que hace una pulsación lo decide la pantalla. Las medidas son las de la lámina (el sistema de
 * diseño usa otras en sus botones y círculos genéricos: 43 pt y 48 pt frente a los 47 pt y 53 pt de aquí).
 */
export function MapControls({
  provinceName,
  onProvince,
  role,
  onRole,
  category,
  onCategory,
  filterLabel,
  filterActive,
  onFilter,
  onSearch,
}: MapControlsProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <SelectField
        variant="compact"
        height={45}
        leadingIcon="pin"
        emphasis
        valueLabel={provinceName ?? browseStrings.province.loadingChip}
        accessibilityLabel={provinceName !== null ? browseStrings.province.a11yChip(provinceName) : copy.provinceChipA11yLoading}
        onPress={onProvince}
        style={styles.province}
        testID="MapHome.province"
      />
      <RoleButtons role={role} onRole={onRole} />
      <CategoryRow category={category} onCategory={onCategory} />
      <View style={styles.searchRow}>
        <SearchLauncher onPress={onSearch} />
        <FilterButton label={filterLabel} active={filterActive} onPress={onFilter} />
      </View>
    </View>
  );
}

// ── «Busco coche | Ofrezco plazas» ───────────────────────────────────────────────────────────────────────────────────

interface RoleSpec {
  value: MapRole;
  label: string;
  icon: IconName;
  /** Anchura relativa medida en la lámina (183 pt y 175,5 pt: la primera es un poco más ancha). */
  weight: number;
  testID: string;
}

const ROLES: readonly RoleSpec[] = [
  { value: "seeking", label: copy.roleSeeking, icon: "car", weight: 183, testID: "MapHome.role.seeking" },
  { value: "offering", label: copy.roleOffering, icon: "person", weight: 175.5, testID: "MapHome.role.offering" },
];

function RoleButtons({ role, onRole }: { role: MapRole; onRole: (role: MapRole) => void }): React.JSX.Element {
  return (
    <View testID="MapHome.roles" accessibilityRole="tablist" accessibilityLabel={copy.roleGroupA11y} style={styles.roles}>
      {ROLES.map((spec) => {
        const selected = spec.value === role;
        const foreground = selected ? colors.onPrimary : colors.heading;
        return (
          <Pressable
            key={spec.value}
            testID={spec.testID}
            accessibilityRole="tab"
            accessibilityLabel={spec.label}
            accessibilityState={{ selected }}
            onPress={() => onRole(spec.value)}
            style={({ pressed }) => [
              styles.role,
              { flex: spec.weight },
              selected
                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                : { backgroundColor: pressed ? colors.bg.tint : colors.bg.white, borderColor: colors.border.default },
            ]}
          >
            <View style={styles.roleIcon}>
              <Icon name={spec.icon} size={26} color={foreground} />
            </View>
            <Text variant="rowTitle" color={foreground} size={17} weight="medium" letterSpacing={-0.35} numberOfLines={1}>
              {spec.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Categorías ───────────────────────────────────────────────────────────────────────────────────────────────────────

function CategoryRow({ category, onCategory }: { category: TripCategory | null; onCategory: (category: TripCategory) => void }): React.JSX.Element {
  return (
    <View testID="MapHome.category" accessibilityRole="radiogroup" accessibilityLabel={copy.categoriesA11y} style={styles.categories}>
      {tripCategoryOrder.map((item) => {
        const selected = category === item;
        const label = strings.categories[item];
        return (
          <Pressable
            key={item}
            testID={`MapHome.category.${item}`}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onCategory(item)}
            style={styles.categoryCell}
          >
            <View style={[styles.categoryCircle, { backgroundColor: selected ? colors.primary : colors.bg.tintStrong }]}>
              <Icon name={tripCategoryIcon[item]} size={28} color={selected ? colors.onPrimary : colors.primary} />
            </View>
            {/* Una `View` más ancha que la celda: «Universidad» (≈ 59 pt) no cabe en 63 pt con margen y un `Text` con
                `numberOfLines` en web se limita al ancho de su padre. */}
            <View style={styles.categoryLabelBox}>
              <Text variant="tabLabel" color={selected ? "primary" : "heading"} weight={selected ? "semibold" : "medium"} align="center" size={13.5} letterSpacing={-0.3}>
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Buscador y filtro ────────────────────────────────────────────────────────────────────────────────────────────────

/** «¿A dónde vas?»: parece un campo de texto pero abre el buscador de lugares (el teclado se abre allí, no aquí). */
function SearchLauncher({ onPress }: { onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      testID="MapHome.search"
      accessibilityRole="search"
      accessibilityLabel={copy.searchA11y}
      onPress={onPress}
      style={({ pressed }) => [styles.search, pressed ? styles.searchPressed : null]}
    >
      <Icon name="search" size={24} color={colors.heading} />
      <Text variant="body" color="placeholder" size={16} numberOfLines={1} style={styles.searchText}>
        {copy.searchPlaceholder}
      </Text>
    </Pressable>
  );
}

/** «Con plazas ▾»: abre la hoja de filtros. Tiene la anchura de la lámina (143 pt) para que el texto no se recorte. */
function FilterButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      testID="MapHome.filter"
      accessibilityRole="button"
      accessibilityLabel={copy.filterA11y(label, active)}
      onPress={onPress}
      style={({ pressed }) => [styles.filter, pressed ? styles.filterPressed : null]}
    >
      <Icon name="filter" size={24} color={colors.heading} />
      <Text variant="body" color="heading" weight="semibold" size={16} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.filterText}>
        {label}
      </Text>
      <Icon name="chevronDown" size={24} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 12.5 },
  province: { alignSelf: "flex-start", minWidth: 169 },
  roles: { flexDirection: "row", gap: 9.5, marginTop: 6.5 },
  role: {
    minHeight: 47,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  roleIcon: { marginRight: 9 },
  /** Seis celdas iguales; los círculos quedan a 63 pt unos de otros como en la lámina (centros a 39 · 102 · 166 · 229 · 292 · 355 pt). */
  categories: { flexDirection: "row", marginTop: 10.5, marginLeft: -4.5, marginRight: -6.5 },
  categoryCell: { flex: 1, alignItems: "center" },
  categoryCircle: { width: 53.4, height: 53.4, borderRadius: 26.7, alignItems: "center", justifyContent: "center" },
  categoryLabelBox: { marginTop: 3, alignSelf: "stretch", marginHorizontal: -6 },
  searchRow: { flexDirection: "row", marginTop: 19.2, marginBottom: 11 },
  search: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.white,
  },
  searchPressed: { backgroundColor: colors.bg.tintSoft },
  searchText: { marginLeft: 15, flex: 1 },
  filter: {
    width: 143,
    minHeight: 48,
    marginLeft: 9,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 4,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.white,
  },
  filterPressed: { backgroundColor: colors.bg.tintSoft },
  filterText: { flex: 1, marginLeft: 8.5, marginRight: -2 },
});
