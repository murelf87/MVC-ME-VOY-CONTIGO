/** Justificantes: lista paginada con filtro por tipo, detalle estructurado y documento imprimible. */
import type { Receipt, ReceiptKind, ReceiptSummary } from "@/api/types/money";
import { useApiQuery, usePaginatedQuery, type UseApiQueryResult, type UsePaginatedQueryResult } from "@/hooks";
import { getReceipt, getReceiptPrintable, listReceipts } from "../api";
import { moneyKeys } from "./keys";

export function useReceiptsList(kind: ReceiptKind | null): UsePaginatedQueryResult<ReceiptSummary> {
  return usePaginatedQuery<ReceiptSummary>(moneyKeys.receipts(kind), ({ cursor, signal }) => listReceipts({ kind, cursor }, { signal }), {
    staleTimeMs: 15_000,
  });
}

export function useReceipt(receiptId: string): UseApiQueryResult<Receipt> {
  return useApiQuery(moneyKeys.receipt(receiptId), ({ signal }) => getReceipt(receiptId, { signal }), { staleTimeMs: 60_000 });
}

/** Solo se descarga cuando la persona abre la versión imprimible (`enabled`). */
export function useReceiptPrintable(receiptId: string, enabled: boolean): UseApiQueryResult<string> {
  return useApiQuery(moneyKeys.printable(receiptId), ({ signal }) => getReceiptPrintable(receiptId, { signal }), {
    enabled,
    staleTimeMs: 60_000,
  });
}
