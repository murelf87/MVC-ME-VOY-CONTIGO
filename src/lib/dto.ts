/** Formas de cable compartidas con la app (mobile/src/api/types/common.ts). Mantener sincronizadas. */
export type MoneyStatus = "defined" | "pending_definition" | "illustrative";
export type MoneyDto = { cents: number | null; currency: "EUR"; status: MoneyStatus };

export function moneyDefined(cents: number): MoneyDto {
  if (!Number.isInteger(cents)) throw new Error("money must be integer cents");
  return { cents, currency: "EUR", status: "defined" };
}

/** Importe sin política/tarifa aprobada: la UI muestra «Por definir». */
export function moneyPending(): MoneyDto {
  return { cents: null, currency: "EUR", status: "pending_definition" };
}

export type PublicUserDto = {
  id: string;
  displayName: string;
  firstName: string;
  photoUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
};
