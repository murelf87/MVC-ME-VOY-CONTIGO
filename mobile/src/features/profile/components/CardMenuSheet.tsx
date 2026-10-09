/**
 * Hoja del ⋮ de una tarjeta de «Mis viajes»: las acciones de esa tarjeta (ver detalle, retirar la solicitud, pagar,
 * cancelar la reserva, seguir el viaje, gestionar…). Solo aparecen las que el estado de la tarjeta permite.
 */
import React from "react";
import { OptionSheet, type OptionSheetOption } from "@/ui";
import type { CardAction, TripCardView } from "../model/tripCards";

export interface CardMenuSheetProps {
  /** Tarjeta cuyo menú está abierto; `null` = cerrado. */
  view: TripCardView | null;
  onClose: () => void;
  onSelect: (action: CardAction) => void;
  testID?: string;
}

export function CardMenuSheet({ view, onClose, onSelect, testID = "MyTrips.cardMenu" }: CardMenuSheetProps): React.JSX.Element {
  const options = React.useMemo<OptionSheetOption<string>[]>(
    () =>
      (view?.menu ?? []).map((item) => ({
        value: item.id,
        label: item.label,
        icon: item.icon,
        ...(item.destructive === true ? { destructive: true } : {}),
      })),
    [view],
  );
  return (
    <OptionSheet<string>
      testID={testID}
      visible={view !== null}
      title={view?.title}
      options={options}
      onClose={onClose}
      onSelect={(id) => {
        const item = view?.menu.find((candidate) => candidate.id === id);
        onClose();
        if (item !== undefined) onSelect(item.action);
      }}
    />
  );
}
