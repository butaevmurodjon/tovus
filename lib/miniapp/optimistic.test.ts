import { describe, expect, it, vi } from "vitest";
import { optimisticUpdate } from "./optimistic";

describe("optimisticUpdate", () => {
  it("applies the optimistic value immediately, then commits the mutate result", async () => {
    const calls: number[][] = [];
    const setState = vi.fn((next: number[] | ((cur: number[]) => number[])) => {
      const resolved = typeof next === "function" ? (next as (cur: number[]) => number[])(calls.at(-1) ?? []) : next;
      calls.push(resolved);
    });

    await optimisticUpdate<number[]>(
      setState,
      (cur) => [...cur, 1],
      async () => [1, 2],
      async () => {
        throw new Error("reconcile should not run on success");
      }
    );

    expect(calls[0]).toEqual([1]);
    expect(calls[1]).toEqual([1, 2]);
  });

  it("reconciles from the server instead of restoring a stale snapshot on failure", async () => {
    const calls: number[][] = [];
    const setState = vi.fn((next: number[] | ((cur: number[]) => number[])) => {
      const resolved = typeof next === "function" ? (next as (cur: number[]) => number[])(calls.at(-1) ?? []) : next;
      calls.push(resolved);
    });

    await expect(
      optimisticUpdate<number[]>(
        setState,
        (cur) => [...cur, 99],
        async () => {
          throw new Error("network down");
        },
        // Simulates a concurrent change having landed server-side in the meantime —
        // the reconcile result is neither the pre-call snapshot nor the failed
        // optimistic guess, proving rollback doesn't clobber it with either.
        async () => [7, 8]
      )
    ).rejects.toThrow("network down");

    expect(calls[0]).toEqual([99]);
    expect(calls[1]).toEqual([7, 8]);
  });

  it("rethrows the original error and leaves the optimistic guess in place if reconcile also fails", async () => {
    const calls: number[][] = [];
    const setState = vi.fn((next: number[] | ((cur: number[]) => number[])) => {
      const resolved = typeof next === "function" ? (next as (cur: number[]) => number[])(calls.at(-1) ?? []) : next;
      calls.push(resolved);
    });

    await expect(
      optimisticUpdate<number[]>(
        setState,
        (cur) => [...cur, 1],
        async () => {
          throw new Error("mutate failed");
        },
        async () => {
          throw new Error("reconcile also failed");
        }
      )
    ).rejects.toThrow("mutate failed");

    expect(calls).toEqual([[1]]);
  });
});
