/**
 * «En el coche» (23): quién va en el coche. El servidor entrega las personas con perfil visible; los copasajeros que no
 * comparten su perfil llegan con `user: null` y se agrupan en una sola columna («1 pasajero», «2 pasajeros»).
 */
import type { LiveOccupancy, PublicUser } from "@/api/types";

export type OccupantRole = "driver" | "you" | "passenger";

export type OccupantColumn =
  | { kind: "person"; key: string; role: OccupantRole; user: PublicUser }
  | { kind: "hidden"; key: string; count: number };

/** Orden: quien conduce, tú, el resto de pasajeros visibles y, al final, los que no comparten su perfil. */
export function occupantColumns(occupancy: LiveOccupancy): OccupantColumn[] {
  const people: OccupantColumn[] = [];
  const others: OccupantColumn[] = [];
  let hidden = 0;
  let driver: OccupantColumn | null = null;
  let you: OccupantColumn | null = null;
  occupancy.members.forEach((member, index) => {
    if (member.user === null) {
      hidden += 1;
      return;
    }
    if (member.role === "driver") {
      driver = { kind: "person", key: `driver-${member.user.id}`, role: "driver", user: member.user };
    } else if (member.isYou) {
      you = { kind: "person", key: `you-${member.user.id}`, role: "you", user: member.user };
    } else {
      others.push({ kind: "person", key: `passenger-${member.user.id}-${index}`, role: "passenger", user: member.user });
    }
  });
  if (driver !== null) people.push(driver);
  if (you !== null) people.push(you);
  people.push(...others);
  if (hidden > 0) people.push({ kind: "hidden", key: "hidden", count: hidden });
  return people;
}
