/**
 * Destinos favoritos: lectura y escrituras (crear, editar, eliminar). Las escrituras invalidan también la rutina, que
 * enseña los nombres de los destinos.
 */
import type { CreateFavoriteBody, FavoritePlace, FavoritesResponse, UpdateFavoriteBody } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { createFavorite, deleteFavorite, listFavorites, updateFavorite } from "../api";
import { FAVORITES, ROUTINE } from "./keys";

export function useFavorites(): UseApiQueryResult<FavoritesResponse> {
  return useApiQuery<FavoritesResponse>(FAVORITES, ({ signal }) => listFavorites({ signal }), { staleTimeMs: 15_000 });
}

export function useCreateFavorite(): UseApiMutationResult<FavoritePlace, CreateFavoriteBody> {
  return useApiMutation<FavoritePlace, CreateFavoriteBody>((body, { idempotencyKey, signal }) => createFavorite(body, { idempotencyKey, signal }), {
    invalidates: [FAVORITES, ROUTINE],
  });
}

export interface UpdateFavoriteVars {
  id: string;
  body: UpdateFavoriteBody;
}

export function useUpdateFavorite(): UseApiMutationResult<FavoritePlace, UpdateFavoriteVars> {
  return useApiMutation<FavoritePlace, UpdateFavoriteVars>(({ id, body }, { signal }) => updateFavorite(id, body, { signal }), {
    invalidates: [FAVORITES, ROUTINE],
  });
}

export function useDeleteFavorite(): UseApiMutationResult<void, string> {
  return useApiMutation<void, string>((id, { signal }) => deleteFavorite(id, { signal }), { invalidates: [FAVORITES, ROUTINE] });
}
