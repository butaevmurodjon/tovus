import type { Dispatch, SetStateAction } from "react";

/**
 * Applies `optimisticNext` to local state immediately, fires `mutate()` in the
 * background, and commits its result on success. On failure, instead of
 * restoring a snapshot captured before the call started — which can clobber a
 * different, already-committed change made by a concurrent call in the
 * meantime — it re-fetches the authoritative state via `reconcile()` and
 * commits that. Always rethrows the original error so callers can still
 * distinguish failure types (e.g. a 402 Pro-gating error).
 */
export async function optimisticUpdate<S>(
  setState: Dispatch<SetStateAction<S>>,
  optimisticNext: (cur: S) => S,
  mutate: () => Promise<S>,
  reconcile: () => Promise<S>
): Promise<void> {
  setState(optimisticNext);
  try {
    const next = await mutate();
    setState(next);
  } catch (err) {
    try {
      setState(await reconcile());
    } catch {
      // Reconciliation failed too (e.g. offline) — leave the optimistic guess
      // in place; there's nothing more useful to do without a connection.
    }
    throw err;
  }
}
