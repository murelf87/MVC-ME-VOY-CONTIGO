import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/api";
import type { Page, SupportCategory, SupportTicketDetail, SupportTripOption } from "@/api/types";
import { useIsOnline, type UseApiQueryResult } from "@/hooks";
import { describeTripOption, hasErrors, validateTicketForm, type TicketFormErrors } from "../logic/support";
import { helpStrings } from "../strings";
import { useCreateTicket, useSupportTrips } from "./useSupport";
import { useSupportAttachments, type UseSupportAttachmentsResult } from "./useSupportAttachments";

export interface TicketFormInitial {
  category?: SupportCategory;
  tripId?: string;
}

export interface UseTicketFormResult {
  category: SupportCategory | null;
  setCategory(category: SupportCategory): void;
  tripId: string | null;
  /** Viaje elegido (si ya se cargó la lista). */
  trip: SupportTripOption | null;
  tripLabel: string | null;
  setTripId(tripId: string | null): void;
  trips: UseApiQueryResult<Page<SupportTripOption>>;
  body: string;
  setBody(body: string): void;
  attachments: UseSupportAttachmentsResult;
  /** Errores que ya se pueden enseñar (solo tras el primer intento de envío). */
  errors: TicketFormErrors;
  submitting: boolean;
  /** Mensaje del último intento fallido (o `null`). */
  sendError: { title: string; message: string; offline: boolean } | null;
  /** Valida y envía. Si sale bien, vacía el formulario y devuelve la consulta creada; si no, `undefined`. */
  submit(): Promise<SupportTicketDetail | undefined>;
}

/**
 * Estado y envío del formulario «Enviar consulta» (lámina 35/36): tipo, viaje opcional, texto de 1–500 caracteres y hasta
 * 4 imágenes. Valida en español, no envía mientras suben imágenes y reutiliza la `Idempotency-Key` al reintentar.
 */
export function useTicketForm(initial: TicketFormInitial, signedIn: boolean): UseTicketFormResult {
  const online = useIsOnline();
  const [category, setCategoryState] = useState<SupportCategory | null>(initial.category ?? null);
  const [tripId, setTripIdState] = useState<string | null>(initial.tripId ?? null);
  const [body, setBody] = useState("");
  const [attempted, setAttempted] = useState(false);
  const attachments = useSupportAttachments();
  const trips = useSupportTrips(signedIn);
  const create = useCreateTicket();
  const wasOnline = useRef(online);

  // Un mensaje de «sin conexión» se retira solo cuando vuelve la red (el texto sigue en el formulario).
  useEffect(() => {
    if (!wasOnline.current && online && create.isOffline) create.reset();
    wasOnline.current = online;
  }, [online, create]);

  const trip = useMemo(() => trips.data?.items.find((option) => option.tripId === tripId) ?? null, [trips.data, tripId]);
  const tripLabel = trip !== null ? describeTripOption(trip) : null;

  const errors = useMemo<TicketFormErrors>(
    () => (attempted ? validateTicketForm({ category, body, uploadingCount: attachments.uploadingCount }) : {}),
    [attempted, category, body, attachments.uploadingCount],
  );

  const setCategory = useCallback((next: SupportCategory) => setCategoryState(next), []);

  // El viaje es solo contexto: una consulta de pago o de cuenta también puede referirse a un viaje, así que elegirlo no
  // cambia el tipo (la lámina 36 enseña un viaje elegido con los tres tipos sin marcar).
  const setTripId = useCallback((next: string | null) => setTripIdState(next), []);

  const submit = useCallback(async (): Promise<SupportTicketDetail | undefined> => {
    setAttempted(true);
    const found = validateTicketForm({ category, body, uploadingCount: attachments.uploadingCount });
    if (hasErrors(found) || category === null) return undefined;
    const request = {
      category,
      body: body.trim(),
      ...(tripId !== null ? { tripId } : null),
      ...(trip?.bookingId ? { bookingId: trip.bookingId } : null),
      ...(attachments.attachmentIds.length > 0 ? { attachmentIds: attachments.attachmentIds } : null),
    };
    const detail = await create.mutate(request);
    if (detail !== undefined) {
      setBody("");
      setTripIdState(null);
      setCategoryState(null);
      setAttempted(false);
      attachments.reset();
      create.reset();
    }
    return detail;
  }, [attachments, body, category, create, trip, tripId]);

  const sendError =
    create.error === null
      ? null
      : create.isOffline
        ? { title: helpStrings.help.sendFailedTitle, message: helpStrings.help.sendOfflineMessage, offline: true }
        : { title: helpStrings.help.sendFailedTitle, message: errorMessage(create.error), offline: false };

  return {
    category,
    setCategory,
    tripId,
    trip,
    tripLabel,
    setTripId,
    trips,
    body,
    setBody,
    attachments,
    errors,
    submitting: create.isPending,
    sendError,
    submit,
  };
}
