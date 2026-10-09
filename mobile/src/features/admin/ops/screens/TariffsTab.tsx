/**
 * Pestaña «Tarifas» del panel (lámina 40a/40b): el borrador de la tarifa, el ejemplo de aportación (calculado por el
 * servidor sin guardar nada), las restricciones y alertas de operación, y, bajo el pliegue, la tarifa en vigor, la
 * activación (hoy BLOQUEADA por `ECONOMICS_ACTIVATION`) y el historial.
 *
 * Las dos láminas son el MISMO formulario con datos distintos: sin comisiones definidas (40a) las comisiones y la cuota
 * Premium son cajas «Por definir ⌄» que abren una hoja; con comisiones (40b) son campos numéricos. Los importes viajan
 * como enteros (micro-euros, puntos básicos, céntimos). RBAC: lectura y escritura Administración y Finanzas.
 */
import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { describeError } from "@/api";
import type { AdminTariffOverview, AdminTariffPublishRequest } from "@/api/types";
import { formatDateTime } from "@/i18n";
import { useAppNavigation } from "@/navigation";
import { Skeleton, showToast } from "@/ui";
import { DefinitionSheet } from "../components/DefinitionSheet";
import { ActivateSheet, ActivationCard, ActiveTariffCard, DraftExtrasCard } from "../components/ExtraCards";
import { ExampleCard } from "../components/ExampleCard";
import { NoticeBanner } from "../components/NoticeBanner";
import { OperationsPanel } from "../components/OperationsPanel";
import { LinkRow } from "../components/PanelCard";
import { NoPermissionState, QueryErrorState, StaleNotice } from "../components/StateViews";
import { TabScroll } from "../components/TabScroll";
import { TariffCard, type DefinableField } from "../components/TariffCard";
import { TariffFooter } from "../components/TariffFooter";
import { useOperations } from "../hooks/useOperations";
import { usePublishTariff, useSaveTariffDraft, useTariffExample, useTariffOverview } from "../hooks/useTariffs";
import { parseRatePerKm } from "../model/money";
import type { OpsAccess } from "../model/permissions";
import {
  EXAMPLE_DISTANCE_METERS,
  exampleRequestFor,
  formFromDraft,
  isDraftComplete,
  isTariffDirty,
  kmText,
  parseDistanceKm,
  tariffLook,
  validateTariffForm,
  type TariffField,
  type TariffForm,
} from "../model/tariff";
import { opsStrings } from "../strings";

export interface TariffsTabProps {
  access: OpsAccess;
}

export function TariffsTab({ access }: TariffsTabProps): React.JSX.Element {
  const overview = useTariffOverview(access.readTariffs);
  const operations = useOperations(access.readOperations);
  const refetchAll = React.useCallback(() => {
    void overview.refetch();
    void operations.refetch();
  }, [overview, operations]);

  if (!access.readTariffs) {
    return (
      <TabScroll testID="OpsTariffs">
        <NoPermissionState section={opsStrings.tabs.tariffs} testID="OpsTariffs.noPermission" />
      </TabScroll>
    );
  }
  if (overview.data === undefined) {
    if (overview.isError || overview.isOffline) {
      return (
        <TabScroll testID="OpsTariffs">
          <QueryErrorState error={overview.error} onRetry={refetchAll} section={opsStrings.tabs.tariffs} testID="OpsTariffs.error" />
        </TabScroll>
      );
    }
    return (
      <TabScroll testID="OpsTariffs">
        <View testID="OpsTariffs.loading" accessible accessibilityLabel={opsStrings.common.loading} accessibilityState={{ busy: true }}>
          <Skeleton height={356} radius={16} />
          <Skeleton height={67} radius={16} style={styles.skeletonGap} />
          <Skeleton height={133} radius={16} style={styles.skeletonGap} />
        </View>
      </TabScroll>
    );
  }

  const offline = overview.isOffline || operations.isOffline;
  const failed = overview.failedToRefresh || operations.failedToRefresh;
  return (
    <TariffEditor
      overview={overview.data}
      access={access}
      refreshing={overview.isRefreshing}
      onRefresh={refetchAll}
      stale={<StaleNotice offline={offline} failedToRefresh={failed} onRetry={refetchAll} testID="OpsTariffs.stale" />}
    />
  );
}

interface TariffEditorProps {
  overview: AdminTariffOverview;
  access: OpsAccess;
  stale: React.ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
}

function TariffEditor({ overview, access, stale, refreshing, onRefresh }: TariffEditorProps): React.JSX.Element {
  const navigation = useAppNavigation();
  const s = opsStrings.tariffs;
  const draft = overview.draft;

  // Formulario: parte del borrador del servidor y solo se realinea con él si la persona no ha tocado nada.
  const baseline = React.useMemo(() => formFromDraft(draft), [draft]);
  const [form, setForm] = React.useState<TariffForm>(baseline);
  const formRef = React.useRef(form);
  formRef.current = form;
  const lastBaseline = React.useRef(baseline);
  React.useEffect(() => {
    const previous = lastBaseline.current;
    lastBaseline.current = baseline;
    if (previous !== baseline && !isTariffDirty(formRef.current, previous)) setForm(baseline);
  }, [baseline]);

  const [forcedInputs, setForcedInputs] = React.useState(() => tariffLook(draft, false) === "inputs");
  React.useEffect(() => {
    if (tariffLook(draft, false) === "inputs") setForcedInputs(true);
  }, [draft]);
  const look = tariffLook(draft, forcedInputs);

  const [touched, setTouched] = React.useState<Partial<Record<TariffField, boolean>>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [distanceText, setDistanceText] = React.useState(() => kmText(EXAMPLE_DISTANCE_METERS));
  const [definition, setDefinition] = React.useState<DefinableField | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [activateOpen, setActivateOpen] = React.useState(false);
  const [activateError, setActivateError] = React.useState<string | null>(null);

  const save = useSaveTariffDraft();
  const publish = usePublishTariff();
  const scrollRef = React.useRef<ScrollView>(null);
  const extrasY = React.useRef(0);

  const validation = React.useMemo(() => validateTariffForm(form), [form]);
  const dirty = isTariffDirty(form, baseline);
  const canWrite = access.writeTariffs;

  const visibleErrors = React.useMemo(() => {
    const result: Partial<Record<TariffField, string>> = {};
    (Object.keys(validation.errors) as TariffField[]).forEach((field) => {
      const message = validation.errors[field];
      if (message !== undefined && (submitted || touched[field] === true)) result[field] = message;
    });
    return result;
  }, [validation, submitted, touched]);

  // Ejemplo calculado por el servidor con lo escrito (no guarda nada).
  const distanceMeters = parseDistanceKm(distanceText);
  const request = distanceMeters === null ? null : exampleRequestFor(form, distanceMeters);
  const example = useTariffExample(request, access.readTariffs);
  const parsedRate = parseRatePerKm(form.rate);
  const rateMicros = parsedRate.ok ? parsedRate.value : null;

  const change = React.useCallback((field: TariffField, text: string) => setForm((current) => ({ ...current, [field]: text })), []);
  const blur = React.useCallback((field: TariffField) => setTouched((current) => ({ ...current, [field]: true })), []);

  const applyDefinition = (field: DefinableField, text: string): void => {
    change(field, text);
    setForcedInputs(true);
    setDefinition(null);
  };
  const clearDefinition = (field: DefinableField): void => {
    change(field, "");
    setDefinition(null);
  };

  const discard = (): void => {
    setForm(baseline);
    setSubmitted(false);
    setTouched({});
  };

  const onSave = async (): Promise<void> => {
    setSubmitted(true);
    if (!validation.valid || validation.input === null) {
      showToast({ kind: "warning", message: s.fixErrors, id: "ops-tariff" });
      const inExtras = validation.errors.cap !== undefined || validation.errors.notes !== undefined;
      scrollRef.current?.scrollTo({ y: inExtras ? Math.max(extrasY.current - 12, 0) : 0, animated: true });
      return;
    }
    if (!dirty) {
      showToast({ kind: "info", message: s.nothingToSave, id: "ops-tariff" });
      return;
    }
    try {
      const saved = await save.mutateAsync(validation.input);
      setForm(formFromDraft(saved));
      setSubmitted(false);
      setTouched({});
      showToast({ kind: "success", title: s.saved, message: s.savedDetail, id: "ops-tariff" });
    } catch (error) {
      const info = describeError(error);
      showToast({ kind: "error", title: info.title, message: info.message, id: "ops-tariff" });
    }
  };

  const onActivate = async (requestBody: AdminTariffPublishRequest): Promise<void> => {
    if (draft === null) return;
    setActivateError(null);
    try {
      await publish.mutateAsync({ versionId: draft.id, request: requestBody });
      setActivateOpen(false);
      showToast({ kind: "success", title: opsStrings.activate.success, message: opsStrings.activate.successDetail, id: "ops-tariff" });
    } catch (error) {
      const info = describeError(error);
      setActivateError(info.code === "ECONOMICS_ACTIVATION_DISABLED" ? opsStrings.activate.blocked : info.message);
    }
  };

  const draftReady = isDraftComplete(draft);
  const notReadyReason = !draftReady ? s.activateIncomplete : dirty ? s.activateSaveFirst : null;
  const meta =
    draft === null
      ? s.noDraft
      : s.draftMeta(draft.version, formatDateTime(draft.updatedAt), draft.updatedBy?.displayName ?? null);

  const exampleBox = (
    <ExampleCard
      look={look}
      example={example.data}
      distanceMeters={distanceMeters ?? EXAMPLE_DISTANCE_METERS}
      rateMicros={rateMicros}
      loading={example.isLoading || (example.isFetching && example.data === undefined)}
      invalid={request === null}
      failed={example.data === undefined && (example.isError || example.isOffline)}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      testID="OpsTariffs.example"
    />
  );

  return (
    <TabScroll
      testID="OpsTariffs"
      scrollRef={scrollRef}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        <TariffFooter
          auditNote={overview.auditNote}
          saving={save.isPending}
          dirty={dirty}
          canWrite={canWrite}
          onSave={() => {
            void onSave();
          }}
          testID="OpsTariffs.footer"
        />
      }
    >
      {stale}
      <TariffCard
        testID="OpsTariffs.card"
        form={form}
        errors={visibleErrors}
        look={look}
        disabled={!canWrite || save.isPending}
        onChange={change}
        onBlurField={blur}
        onOpenDefinition={setDefinition}
        example={exampleBox}
      />
      <OperationsPanel access={access} variant="summary" showStaleNotice={false} testID="OpsTariffs.operations" />
      <NoticeBanner text={overview.applyNote} testID="OpsTariffs.notice" />

      <View
        style={styles.below}
        onLayout={(event) => {
          extrasY.current = event.nativeEvent.layout.y;
        }}
      >
        <DraftExtrasCard
          testID="OpsTariffs.extras"
          meta={meta}
          cap={form.cap}
          capError={visibleErrors.cap}
          notes={form.notes}
          notesError={visibleErrors.notes}
          distance={distanceText}
          distanceError={distanceMeters === null ? s.distanceError : undefined}
          disabled={!canWrite || save.isPending}
          dirty={dirty}
          onChangeCap={(text) => change("cap", text)}
          onChangeNotes={(text) => change("notes", text)}
          onChangeDistance={setDistanceText}
          onBlurField={(field) => blur(field)}
          onDiscard={discard}
        />
      </View>
      <View style={styles.cardGap}>
        <ActiveTariffCard active={overview.active} testID="OpsTariffs.active" />
      </View>
      <View style={styles.cardGap}>
        <ActivationCard
          activation={overview.activation}
          canActivate={access.activateTariffs}
          notReadyReason={notReadyReason}
          onActivate={() => {
            setActivateError(null);
            setActivateOpen(true);
          }}
          testID="OpsTariffs.activation"
        />
      </View>
      <View style={styles.cardGap}>
        <LinkRow
          icon="opsHistory"
          title={s.historyLink}
          subtitle={s.historySubtitle}
          onPress={() => navigation.navigate("AdminTariffVersions")}
          testID="OpsTariffs.history"
        />
      </View>

      <DefinitionSheet
        field={definition}
        value={definition === null ? "" : form[definition]}
        onApply={applyDefinition}
        onClear={clearDefinition}
        onClose={() => setDefinition(null)}
      />
      <ActivateSheet
        visible={activateOpen}
        busy={publish.isPending}
        serverError={activateError}
        onClose={() => setActivateOpen(false)}
        onSubmit={(body) => {
          void onActivate(body);
        }}
      />
    </TabScroll>
  );
}

const styles = StyleSheet.create({
  skeletonGap: { marginTop: 9 },
  below: { marginTop: 16 },
  cardGap: { marginTop: 12 },
});
