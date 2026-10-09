/**
 * Nueva consulta: el mismo formulario que el Centro de ayuda (tipo, viaje opcional, texto de hasta 500 caracteres,
 * imágenes) en una pantalla propia. Al enviar abre el hilo con la referencia.
 */
import React from "react";
import { showToast, Screen, ScreenHeader } from "@/ui";
import { requireAccount, type AppScreenProps } from "@/navigation";
import { useAuth } from "@/session";
import type { SupportTicketDetail } from "@/api/types";
import { GuestNotice } from "../components/StateCards";
import { TicketForm } from "../components/TicketForm";
import { useTicketForm } from "../hooks/useTicketForm";
import { helpStrings } from "../strings";

export function SupportNewTicketScreen({ navigation, route }: AppScreenProps<"SupportNewTicket">): React.JSX.Element {
  const signedIn = useAuth().status === "signedIn";
  const form = useTicketForm({ tripId: route.params?.tripId }, signedIn);
  const header = <ScreenHeader title={helpStrings.tickets.newTitle} testID="SupportNewTicket.header" />;

  const sent = (ticket: SupportTicketDetail): void => {
    showToast({ message: helpStrings.help.sentTitle, kind: "success", durationMs: 2000 });
    navigation.replace("SupportTicketDetail", { ticketId: ticket.id, sent: true });
  };

  return (
    <Screen testID="SupportNewTicket" header={header}>
      {signedIn ? (
        <TicketForm form={form} onSubmitted={sent} testID="SupportNewTicket.form" />
      ) : (
        <GuestNotice testID="SupportNewTicket.guest" message={helpStrings.help.guestMessage} onSignIn={() => requireAccount({ name: "SupportNewTicket" })} />
      )}
    </Screen>
  );
}
