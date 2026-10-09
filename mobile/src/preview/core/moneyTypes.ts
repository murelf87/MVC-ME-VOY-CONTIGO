export type MoneyStatus = "defined" | "pending_definition" | "illustrative";
export interface MoneyDto {
  cents: number | null;
  currency: "EUR";
  status: MoneyStatus;
}
