import React, { useState } from "react";
import { View } from "react-native";
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  Dialog,
  OptionSheet,
  PermissionExplainer,
  Segmented,
  Text,
  hideToast,
  showToast,
  type PermissionKind,
  type PermissionStatus,
} from "@/ui";
import { Demo, Group, Wrap } from "../GalleryParts";

type Sort = "hora" | "precio" | "distancia";
const sortOptions = [
  { value: "hora", label: "Hora de salida", description: "Los más tempranos primero" },
  { value: "precio", label: "Precio", description: "Propuesta más baja primero" },
  { value: "distancia", label: "Distancia a tu punto", icon: "walk" },
] as const;

const actionOptions = [
  { value: "share", label: "Compartir viaje", icon: "share" },
  { value: "report", label: "Denunciar", icon: "alertCircle", destructive: true },
] as const;

export function OverlaysSection(): React.JSX.Element {
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState(false);
  const [actions, setActions] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [destructive, setDestructive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Sort>("hora");
  const [kind, setKind] = useState<PermissionKind>("location");
  const [status, setStatus] = useState<PermissionStatus>("undetermined");
  const [loading, setLoading] = useState(false);

  const confirmDelete = (): void => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setDestructive(false);
      showToast({ kind: "success", title: "Reserva cancelada", message: "Te avisaremos si hay novedades." });
    }, 900);
  };

  return (
    <View>
      <Group title="Toasts">
        <Demo title="showToast()" note="Un ToastHost en la raíz de la app los dibuja; aquí hay uno propio">
          <Wrap>
            <Button label="Info" size="xs" inline variant="tint" onPress={() => showToast({ kind: "info", message: "Hemos actualizado los trayectos." })} />
            <Button label="Éxito" size="xs" inline variant="successSoft" onPress={() => showToast({ kind: "success", title: "Solicitud enviada", message: "Ana la revisará en breve." })} />
            <Button label="Aviso" size="xs" inline variant="tint" onPress={() => showToast({ kind: "warning", message: "Sin conexión. Mostrando datos guardados." })} />
            <Button label="Error" size="xs" inline variant="dangerSoft" onPress={() => showToast({ kind: "error", title: "No se pudo guardar", message: "Inténtalo de nuevo.", actionLabel: "Reintentar", onAction: () => showToast("Reintentando…") })} />
            <Button label="Cerrar" size="xs" inline variant="ghost" onPress={() => hideToast()} />
          </Wrap>
        </Demo>
      </Group>
      <Group title="Hojas y diálogos">
        <Demo title="BottomSheet">
          <Button label="Abrir hoja" variant="outline" size="sm" onPress={() => setSheet(true)} testID="Gallery.openSheet" />
        </Demo>
        <Demo title="OptionSheet · elegir">
          <Button label={`Ordenar por: ${sortOptions.find((o) => o.value === order)?.label ?? ""}`} variant="outline" size="sm" onPress={() => setSort(true)} />
        </Demo>
        <Demo title="OptionSheet · acciones (⋮)">
          <Button label="Más acciones" variant="outline" size="sm" onPress={() => setActions(true)} />
        </Demo>
        <Demo title="Dialog">
          <Button label="Abrir diálogo" variant="outline" size="sm" onPress={() => setDialog(true)} />
        </Demo>
        <Demo title="ConfirmDialog">
          <Wrap>
            <Button label="Confirmación" variant="outline" size="sm" inline onPress={() => setConfirm(true)} />
            <Button label="Destructiva" variant="dangerOutline" size="sm" inline onPress={() => setDestructive(true)} />
          </Wrap>
        </Demo>
      </Group>
      <Group title="PermissionExplainer">
        <Demo title="permiso">
          <Segmented
            variant="pills"
            scrollable
            value={kind}
            onChange={setKind}
            options={[
              { value: "location", label: "Ubicación" },
              { value: "camera", label: "Cámara" },
              { value: "notifications", label: "Avisos" },
              { value: "photos", label: "Fotos" },
            ]}
          />
        </Demo>
        <Demo title="estado">
          <Segmented
            variant="pills"
            scrollable
            value={status}
            onChange={setStatus}
            options={[
              { value: "undetermined", label: "Sin pedir" },
              { value: "denied", label: "Denegado" },
              { value: "blocked", label: "Bloqueado" },
            ]}
          />
        </Demo>
        <View style={{ marginTop: 20 }}>
          <PermissionExplainer
            kind={kind}
            status={status}
            loading={loading}
            onRequest={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 900);
            }}
            onOpenSettings={() => showToast("Se abrirían los ajustes del sistema.")}
            onSkip={() => showToast("Continúas sin el permiso.")}
          />
        </View>
      </Group>

      <BottomSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="Condiciones de cancelación"
        subtitle="Propuesta pendiente de revisión"
        footer={<Button label="Entendido" onPress={() => setSheet(false)} chevron={false} />}
      >
        <Text variant="body" color="body">
          Puedes cancelar tu reserva desde «Mis viajes». Si corresponde, los reembolsos obligatorios por ley se realizarán según la normativa vigente.
        </Text>
      </BottomSheet>
      <OptionSheet
        visible={sort}
        title="Ordenar por"
        options={sortOptions}
        selected={order}
        onSelect={(value) => {
          setOrder(value);
          setSort(false);
        }}
        onClose={() => setSort(false)}
      />
      <OptionSheet
        visible={actions}
        title="Viaje con Ana"
        options={actionOptions}
        onSelect={(value) => {
          setActions(false);
          showToast(value === "share" ? "Enlace copiado." : "Gracias. Revisaremos tu denuncia.");
        }}
        onClose={() => setActions(false)}
      />
      <Dialog
        visible={dialog}
        onClose={() => setDialog(false)}
        icon="shield"
        title="Tu viaje está protegido"
        message="Solo compartimos tu ubicación con tu conductor mientras dura el trayecto."
        actions={<Button label="De acuerdo" chevron={false} onPress={() => setDialog(false)} />}
      />
      <ConfirmDialog
        visible={confirm}
        title="¿Salir sin guardar?"
        message="Se perderán los cambios que no hayas guardado."
        confirmLabel="Salir"
        cancelLabel="Seguir editando"
        onConfirm={() => setConfirm(false)}
        onCancel={() => setConfirm(false)}
      />
      <ConfirmDialog
        visible={destructive}
        destructive
        loading={busy}
        title="Cancelar reserva"
        message="Si corresponde, los reembolsos obligatorios por ley se realizarán según la normativa vigente."
        confirmLabel="Confirmar cancelación"
        cancelLabel="Mantener reserva"
        onConfirm={confirmDelete}
        onCancel={() => setDestructive(false)}
      />
    </View>
  );
}
