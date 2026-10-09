import type { BlockedUser } from "@/api/types";
import { usePaginatedQuery, type UsePaginatedQueryResult } from "@/hooks";
import { listBlockedUsers } from "../api";
import { BLOCKS_KEY } from "./keys";

/** `GET /v1/me/blocks`: personas que he bloqueado, de la más reciente a la más antigua. */
export function useBlockedUsers(): UsePaginatedQueryResult<BlockedUser> {
  return usePaginatedQuery<BlockedUser>([...BLOCKS_KEY, "list"], ({ cursor, signal }) => listBlockedUsers({ cursor, limit: 20 }, { signal }), {
    getItemId: (b) => b.user.id,
    staleTimeMs: 10_000,
  });
}
