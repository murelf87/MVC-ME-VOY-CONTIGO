/**
 * Opciones de los tres selectores de 38 («Todos», «Rol», «Más recientes»). Las hojas de opciones trabajan con cadenas;
 * aquí se traducen a los valores tipados del filtro (`null` = sin filtrar) y viceversa. Funciones puras.
 */
import type { AdminReviewItemKey } from "@/api/types";
import type { OptionSheetOption } from "@/ui";
import { reviewStrings } from "../strings";
import { ITEM_FILTER_ORDER, type QueueFilters } from "./reviewQueue";

export type ItemFilterValue = "all" | AdminReviewItemKey;
export type RoleFilterValue = "all" | "driver" | "passenger";
export type SortValue = QueueFilters["sort"];

const f = reviewStrings.users.filters;

export function itemFilterOptions(): Array<OptionSheetOption<ItemFilterValue>> {
  return [{ value: "all", label: f.itemAll }, ...ITEM_FILTER_ORDER.map((key) => ({ value: key, label: f.itemLabels[key] }))];
}

export function roleFilterOptions(): Array<OptionSheetOption<RoleFilterValue>> {
  return [
    { value: "all", label: f.roleAll },
    { value: "driver", label: f.roleDriver },
    { value: "passenger", label: f.rolePassenger },
  ];
}

export function sortOptions(): Array<OptionSheetOption<SortValue>> {
  return [
    { value: "recent", label: f.sortRecent, description: f.sortRecentHint },
    { value: "oldest", label: f.sortOldest, description: f.sortOldestHint },
  ];
}

export function itemFilterValue(item: QueueFilters["item"]): ItemFilterValue {
  return item ?? "all";
}

export function roleFilterValue(role: QueueFilters["role"]): RoleFilterValue {
  return role ?? "all";
}

export function fromItemFilter(value: ItemFilterValue): QueueFilters["item"] {
  return value === "all" ? null : value;
}

export function fromRoleFilter(value: RoleFilterValue): QueueFilters["role"] {
  return value === "all" ? null : value;
}
