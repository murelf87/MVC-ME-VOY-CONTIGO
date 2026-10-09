/**
 * Buscador de lugares (sin lámina; se diseña con la lámina 10 «Define tu recorrido» al lado: mismo campo compacto,
 * misma tarjeta «Usar mi ubicación» y los mismos espaciados). Resuelve texto → coordenadas con la geocodificación del
 * núcleo y DEVUELVE el lugar a quien lo abrió (ver `placeNavigation.ts`).
 *
 * Parámetros (`SearchParams["PlaceSearch"]`):
 *  - `field`: "origin" | "destination" (vuelven a `DefineRoute`) o "place" (lugar genérico; EXIGE `returnTo`).
 *  - `current`: lugar actual del campo (se precarga para poder corregirlo).
 *  - `returnTo`: `{ route, param }` de la pantalla a la que se devuelve el lugar.
 *  - `title`: título de la cabecera cuando `field` es "place".
 *
 * Estados: pista con recientes · cargando · resultados · sin resultados · sin conexión · error con reintento (también el
 * 429 del límite de frecuencia de invitados) · sesión rechazada (401: aviso para entrar) · sin permiso de ubicación
 * (permitir / ajustes / reintentar) · fuera de provincia. Un invitado busca igual que quien tiene cuenta.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View, type TextInput } from "react-native";
import { describeError } from "@/api";
import { IconTile } from "@/icons";
import { requireAccount, type AppScreenProps } from "@/navigation";
import {
  Banner,
  Button,
  Divider,
  EmptyState,
  ErrorStateCard,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spinner,
  Text,
  TextField,
} from "@/ui";
import { GuestNotice } from "../components/GuestNotice";
import { LocationCard } from "../components/LocationCard";
import { useMyLocationPlace } from "../hooks/useMyLocationPlace";
import { usePlaceSearch } from "../hooks/usePlaceSearch";
import { usePlaceSelection } from "../hooks/usePlaceSelection";
import { useRecentPlaces } from "../hooks/useRecentPlaces";
import { locateProblem } from "../logic/locate";
import type { PlaceItem } from "../logic/placeListView";
import { outsideProvinceCopy, placeSearchPlaceholder, placeSearchTitle, resolveReturnTarget } from "../logic/places";
import { deliverPlace } from "../placeNavigation";
import { browseStrings } from "../strings";
import type { PlaceParam } from "../../routes";

const copy = browseStrings.place;
/** Margen lateral de la lámina 10 (las tarjetas llegan a ≈14 pt del borde). */
const SCREEN_X = 14;

export function PlaceSearchScreen({ navigation, route }: AppScreenProps<"PlaceSearch">): React.JSX.Element {
  const { field, current, returnTo, title } = route.params;
  const [text, setText] = useState(current?.label ?? "");
  const inputRef = useRef<TextInput>(null);
  const picking = useRef(false);

  const search = usePlaceSearch(text);
  const recent = useRecentPlaces();
  const locator = useMyLocationPlace();
  const selection = usePlaceSelection(field);

  // El teclado se abre solo (la persona viene a escribir). En la vista previa web se omite: el navegador pintaría un
  // aro de foco que no existe en el móvil.
  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, []);

  const deliver = useCallback(
    (place: PlaceParam) => {
      const target = resolveReturnTarget(field, returnTo);
      if (target === null) {
        navigation.goBack();
        return;
      }
      deliverPlace(navigation, target, place);
    },
    [field, returnTo, navigation],
  );

  const pick = useCallback(
    async (place: PlaceParam, remember: boolean): Promise<void> => {
      if (picking.current) return;
      picking.current = true;
      try {
        if (!(await selection.validate(place))) return;
        if (remember) recent.remember(place);
        deliver(place);
      } finally {
        picking.current = false;
      }
    },
    [selection, recent, deliver],
  );

  const useMyLocation = useCallback(async (): Promise<void> => {
    selection.reset();
    const place = await locator.locate();
    if (place !== null) await pick(place, false);
  }, [selection, locator, pick]);

  const createAccount = useCallback(() => {
    requireAccount({ name: "PlaceSearch", params: route.params });
  }, [route.params]);

  const onSubmit = useCallback(() => {
    if (search.view.kind === "results") {
      const first = search.view.items[0];
      if (first !== undefined) void pick(first.place, true);
    }
  }, [search.view, pick]);

  const problem = locateProblem(locator.status);
  const checking = selection.state.kind === "checking";
  const hint = search.view.kind === "hint";

  return (
    <Screen
      testID="PlaceSearch"
      paddingX={SCREEN_X}
      header={<ScreenHeader title={placeSearchTitle(field, title)} testID="PlaceSearch.header" />}
    >
      <View style={styles.block}>
        <TextField
          variant="compact"
          height={48}
          leadingIcon="search"
          clearable
          value={text}
          onChangeText={(next) => {
            setText(next);
            if (selection.state.kind !== "idle") selection.reset();
          }}
          placeholder={placeSearchPlaceholder(field)}
          accessibilityLabel={copy.a11yField}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
          inputRef={inputRef}
          testID="PlaceSearch.input"
        />
        {!hint || text.trim().length === 0 ? null : <Text variant="rowText" color="subtle" style={styles.minChars}>{copy.minChars}</Text>}
      </View>

      <View style={styles.block}>
        <LocationCard
          title={copy.useMyLocation}
          subtitle={locator.isLocating ? copy.locating : copy.useMyLocationHint}
          onPress={() => void useMyLocation()}
          loading={locator.isLocating}
          testID="PlaceSearch.useLocation"
        />
      </View>

      {problem !== null ? (
        <View style={styles.block} testID="PlaceSearch.locationProblem">
          <Banner kind={problem.needsSettings ? "notice" : "warning"} title={problem.title} message={problem.message} size="sm" />
          <View style={styles.actions}>
            {problem.canAllow ? (
              <Button label={copy.allowLocation} size="sm" inline chevron={false} onPress={() => void useMyLocation()} testID="PlaceSearch.allowLocation" />
            ) : null}
            {problem.needsSettings ? (
              <Button label={copy.openSettings} size="sm" inline chevron={false} onPress={locator.openSettings} testID="PlaceSearch.openSettings" />
            ) : null}
            {problem.canRetry ? (
              <Button label={browseStrings.common.retry} size="sm" inline chevron={false} onPress={() => void useMyLocation()} testID="PlaceSearch.retryLocation" />
            ) : null}
          </View>
        </View>
      ) : null}

      <SelectionNotice
        state={selection.state}
        field={field}
        checking={checking}
        onRetry={() => selection.reset()}
      />

      <View style={styles.list}>
        {search.view.kind === "hint" ? (
          <RecentPlaces
            places={recent.places}
            onPick={(place) => void pick(place, true)}
            onClear={recent.clear}
          />
        ) : null}

        {search.view.kind === "loading" ? <SkeletonList count={3} variant="row" /> : null}

        {search.view.kind === "results" ? (
          <View testID="PlaceSearch.results">
            <SectionHeader title={copy.results} style={styles.sectionHeader} />
            {search.view.items.map((item, index) => (
              <React.Fragment key={item.id}>
                {index > 0 ? <Divider /> : null}
                <PlaceRow item={item} onPress={() => void pick(item.place, true)} testID={`PlaceSearch.result.${index}`} />
              </React.Fragment>
            ))}
          </View>
        ) : null}

        {search.view.kind === "empty" ? (
          <EmptyState icon="search" title={copy.noResultsTitle} message={copy.noResultsMessage} testID="PlaceSearch.empty" />
        ) : null}

        {search.view.kind === "offline" ? (
          <OfflineBanner
            detail={copy.offlineDetail}
            retryLabel={browseStrings.common.retry}
            onRetry={search.retry}
            testID="PlaceSearch.offline"
          />
        ) : null}

        {search.view.kind === "error" ? (
          <ErrorStateCard
            tone="red"
            icon="exclaim"
            iconTone="solidRed"
            title={describeError(search.view.error).title}
            message={describeError(search.view.error).message}
            actionLabel={browseStrings.common.retry}
            onAction={search.retry}
            testID="PlaceSearch.error"
          />
        ) : null}

        {search.view.kind === "guest" ? (
          <GuestNotice
            title={copy.guestTitle}
            message={copy.guestMessage}
            onCreateAccount={createAccount}
            onKeepExploring={() => navigation.goBack()}
            testID="PlaceSearch.guest"
          />
        ) : null}
      </View>
    </Screen>
  );
}

interface SelectionNoticeProps {
  state: ReturnType<typeof usePlaceSelection>["state"];
  field: "origin" | "destination" | "place";
  checking: boolean;
  onRetry: () => void;
}

/** Avisos al elegir un lugar: comprobando la provincia, fuera de provincia o error de comprobación. */
function SelectionNotice({ state, field, checking, onRetry }: SelectionNoticeProps): React.JSX.Element | null {
  if (checking) {
    return (
      <View style={styles.checking} accessibilityLiveRegion="polite" testID="PlaceSearch.checking">
        <Spinner size="sm" />
        <Text variant="rowText" color="muted" style={styles.checkingText}>
          {copy.searching}
        </Text>
      </View>
    );
  }
  if (state.kind === "outside") {
    const outside = outsideProvinceCopy(field, state.provinceName);
    return (
      <View style={styles.block} testID="PlaceSearch.outside">
        <ErrorStateCard kind="outOfProvince" title={outside.title} message={outside.message} />
      </View>
    );
  }
  if (state.kind === "error") {
    return (
      <View style={styles.block} testID="PlaceSearch.checkFailed">
        <Banner kind="warning" size="sm" message={copy.provinceCheckFailed} />
        <View style={styles.actions}>
          <Button label={browseStrings.common.retry} size="sm" inline chevron={false} onPress={onRetry} testID="PlaceSearch.checkRetry" />
        </View>
      </View>
    );
  }
  return null;
}

interface PlaceRowProps {
  item: Pick<PlaceItem, "title" | "subtitle" | "icon">;
  onPress: () => void;
  testID: string;
}

function PlaceRow({ item, onPress, testID }: PlaceRowProps): React.JSX.Element {
  return (
    <ListRow
      tone="none"
      title={item.title}
      subtitle={item.subtitle ?? undefined}
      leading={<IconTile name={item.icon} tone="blue" size={44} iconSize={24} />}
      trailing="none"
      onPress={onPress}
      accessibilityLabel={copy.resultA11y(item.title, item.subtitle)}
      testID={testID}
      style={styles.row}
    />
  );
}

interface RecentPlacesProps {
  places: readonly PlaceParam[];
  onPick: (place: PlaceParam) => void;
  onClear: () => void;
}

function RecentPlaces({ places, onPick, onClear }: RecentPlacesProps): React.JSX.Element {
  if (places.length === 0) {
    return (
      <Text variant="body" color="muted" align="center" style={styles.typeHint} testID="PlaceSearch.typeHint">
        {copy.typeToSearch}
      </Text>
    );
  }
  return (
    <View testID="PlaceSearch.recent">
      <SectionHeader
        title={copy.recent}
        actionLabel={copy.clearRecent}
        onAction={onClear}
        testID="PlaceSearch.recentHeader"
        style={styles.sectionHeader}
      />
      {places.map((place, index) => (
        <React.Fragment key={`${place.label}:${place.latitude}:${place.longitude}`}>
          {index > 0 ? <Divider /> : null}
          <PlaceRow
            item={{ title: place.label, subtitle: null, icon: "clock" }}
            onPress={() => onPick(place)}
            testID={`PlaceSearch.recent.${index}`}
          />
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 12 },
  minChars: { marginTop: 6, marginLeft: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  list: { marginTop: 16 },
  sectionHeader: { marginBottom: 6 },
  row: { paddingHorizontal: 4 },
  checking: { flexDirection: "row", alignItems: "center", marginTop: 14 },
  checkingText: { marginLeft: 10 },
  typeHint: { marginTop: 24 },
});
