// Minimal in-memory stand-in for the subset of the Upstash Redis client used
// by lib/db/redis.ts's incrWithTtl and lib/moderation/flood.ts. For tests
// only (see redis.test.ts / flood.test.ts) — not imported by any production
// code.
//
// Every method resolves via a real macrotask (setTimeout), so a client-side
// sequence of two separate commands (e.g. GET then DEL) can interleave with
// a concurrent caller's commands the same way it would over a real network
// round trip — while a single command (GETDEL, EVAL) still mutates state
// synchronously the instant it's called, matching Redis's actual
// per-command atomicity. That distinction is what makes the G2/G5
// concurrency regression tests meaningful: they fail against a
// two-call GET-then-DEL or INCR-then-EXPIRE implementation and pass against
// the atomic GETDEL/EVAL ones.

function delayed<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 0));
}

interface PipelineChain {
  set(key: string, value: number, opts?: { ex?: number }): PipelineChain;
  exec(): Promise<unknown[]>;
}

// TZ.md §9.1 G5's shape only (INCR + conditional EXPIRE) — this is not a Lua
// interpreter, just enough to simulate the one script incrWithTtl sends.
// eval() below ignores the actual script text it's given, so these tests pin
// this fake's hardcoded contract, not the real Lua in redis.ts — they can't
// catch a typo or logic error in INCR_WITH_TTL_SCRIPT itself, only a caller
// that stops calling eval() the way this fake expects. There's no Redis
// available in this test environment to close that gap.
export class FakeRedis {
  private store = new Map<string, number>();
  private ttls = new Map<string, number>();
  evalCallCount = 0;

  async get<T>(key: string): Promise<T | null> {
    return delayed((this.store.has(key) ? this.store.get(key) : null) as T | null);
  }

  async del(key: string): Promise<number> {
    const existed = this.store.delete(key);
    this.ttls.delete(key);
    return delayed(existed ? 1 : 0);
  }

  async getdel<T>(key: string): Promise<T | null> {
    const value = this.store.has(key) ? (this.store.get(key) as T) : null;
    this.store.delete(key);
    this.ttls.delete(key);
    return delayed(value);
  }

  async set(key: string, value: number, opts?: { ex?: number }): Promise<"OK"> {
    this.store.set(key, value);
    if (opts?.ex) this.ttls.set(key, opts.ex);
    return delayed("OK");
  }

  async exists(key: string): Promise<number> {
    return delayed(this.store.has(key) ? 1 : 0);
  }

  /** Only the subset used by this repo's callers (markNewMember's two SETs):
   * queues plain synchronous mutations, applied in call order on .exec(),
   * same one-round-trip-per-pipeline contract as the real client. */
  pipeline() {
    const ops: Array<() => unknown> = [];
    const enqueue = <T>(op: () => T): PipelineChain => {
      ops.push(op);
      return chain;
    };
    const chain: PipelineChain = {
      set: (key: string, value: number, opts?: { ex?: number }) =>
        enqueue(() => {
          this.store.set(key, value);
          if (opts?.ex) this.ttls.set(key, opts.ex);
          return "OK";
        }),
      exec: async () => delayed(ops.map((op) => op())),
    };
    return chain;
  }

  /** Mirrors INCR_WITH_TTL_SCRIPT's `count == 1 or TTL == -1` self-heal
   * condition (lib/db/redis.ts) — not a generic Lua interpreter. */
  async eval<TArgs extends unknown[], TData = unknown>(_script: string, keys: string[], args: TArgs): Promise<TData> {
    this.evalCallCount++;
    const key = keys[0];
    const ttlSeconds = Number(args[0]);
    const count = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, count);
    if (count === 1 || !this.ttls.has(key)) this.ttls.set(key, ttlSeconds);
    return delayed(count as TData);
  }

  ttlOf(key: string): number | undefined {
    return this.ttls.get(key);
  }

  /** Test-only seam: simulate a key that leaked under the old two-call
   * INCR-then-EXPIRE code (a nonzero count with no TTL set). */
  seedWithoutTtl(key: string, count: number): void {
    this.store.set(key, count);
    this.ttls.delete(key);
  }
}
