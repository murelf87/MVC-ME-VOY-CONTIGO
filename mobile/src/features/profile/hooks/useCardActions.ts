/**
 * Qué hace cada pulsación de una tarjeta de «Mis viajes» (`CardAction`): abre el detalle, el viaje en directo o la consola
 * del conductor, lleva a pagar o a cancelar, o retira la solicitud pendiente (con confirmación).
 *
 * Es el único sitio que convierte una acción en navegación; los modelos y los componentes solo describen la acción.
 */
import { useCallback, useMemo, useState } from "react";
import { describeError } from "@/api";
import { useAppNavigation } from "@/navigation";
import { showToast } from "@/ui";
import type { CardAction } from "../model/tripCards";
import { profileStrings } from "../strings";
import { useWithdrawRequest } from "./useBookingDetail";

const copy = profileStrings.myTrips.withdraw;

export interface WithdrawDialog {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface CardActions {
  run(action: CardAction): void;
  /** Propiedades de `<ConfirmDialog/>` para «¿Retirar la solicitud?». */
  withdrawDialog: WithdrawDialog;
}

export function useCardActions(): CardActions {
  const navigation = useAppNavigation();
  const withdraw = useWithdrawRequest();
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const { mutateAsync, isPending } = withdraw;

  const run = useCallback(
    (action: CardAction) => {
      switch (action.kind) {
        case "booking":
          navigation.navigate("BookingDetail", { requestId: action.requestId });
          return;
        case "weekly":
          navigation.navigate("WeeklyReservation", { reservationId: action.reservationId });
          return;
        case "series":
          navigation.navigate("RoutePublished", { seriesId: action.seriesId });
          return;
        case "follow":
          // `WaitingForCar` pasa solo a «En el coche» o a «Viaje terminado» según en qué punto esté el viaje.
          navigation.navigate("WaitingForCar", { bookingId: action.bookingId });
          return;
        case "pay":
          navigation.navigate("RequestStatusPayment", { requestId: action.requestId });
          return;
        case "cancel":
          navigation.navigate("CancelBooking", { bookingId: action.bookingId });
          return;
        case "tripFinished":
          navigation.navigate("TripFinished", { bookingId: action.bookingId });
          return;
        case "tripDetail":
          navigation.navigate("TripDetail", { tripId: action.tripId });
          return;
        case "withdraw":
          setPendingRequestId(action.requestId);
          return;
        case "driverManage":
          navigation.navigate("DriverTripManage", { tripId: action.tripId });
          return;
        case "driverConsole":
          navigation.navigate("DriverConsole", { tripId: action.tripId });
          return;
        case "driverFinished":
          navigation.navigate("DriverTripFinished", { tripId: action.tripId });
          return;
        case "driverRequests":
          navigation.navigate("DriverRequests", { tripId: action.tripId });
          return;
      }
    },
    [navigation],
  );

  const confirm = useCallback(async (): Promise<void> => {
    if (pendingRequestId === null) return;
    try {
      await mutateAsync(pendingRequestId);
      setPendingRequestId(null);
      showToast({ kind: "success", message: copy.done, id: "profile.withdraw" });
    } catch (error) {
      setPendingRequestId(null);
      showToast({ kind: "error", message: describeError(error).message, id: "profile.withdraw" });
    }
  }, [pendingRequestId, mutateAsync]);

  const cancel = useCallback(() => {
    if (!isPending) setPendingRequestId(null);
  }, [isPending]);

  const withdrawDialog = useMemo<WithdrawDialog>(
    () => ({
      visible: pendingRequestId !== null,
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.confirm,
      loading: isPending,
      onConfirm: () => void confirm(),
      onCancel: cancel,
    }),
    [pendingRequestId, isPending, confirm, cancel],
  );

  return { run, withdrawDialog };
}
