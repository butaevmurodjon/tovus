// Minimal in-memory stand-in for the subset of the Upstash Redis client used
// by lib/db/redis.ts's incrWithTtl, lib/moderation/flood.ts, and the
// date-bucketed hash counters in lib/db/stats.ts (hincrby/hgetall/expire).
// For tests only (see redis.test.ts / flood.test.ts / stats' own reason-tag
// tests) — not imported by any production code.
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
  // Separate from `store` rather than generalizing it — every existing method
  // here assumes a plain number per key, and the hash counters (stats.ts) are
  // a distinct value shape (one Map of field->count per key), not a value
  // that belongs in the same map.
  private hashes = new Map<string, Map<string, number>>();
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

  async set(key: string, value: number, opts?: { ex?: number; nx?: boolean }): Promise<"OK" | null> {
    if (opts?.nx && this.store.has(key)) return delayed(null);
    this.store.set(key, value);
    if (opts?.ex) this.ttls.set(key, opts.ex);
    return delayed("OK");
  }

  async exists(key: string): Promise<number> {
    return delayed(this.store.has(key) ? 1 : 0);
  }

  /** Hash-per-key counters (group:{chatId}:stats/reasontags/hourly:{date} in
   * stats.ts). Real Upstash hincrby returns the field's new value. */
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, number>();
    const next = (hash.get(field) ?? 0) + increment;
    hash.set(field, next);
    this.hashes.set(key, hash);
    return delayed(next);
  }

  async hgetall<T>(key: string): Promise<T | null> {
    const hash = this.hashes.get(key);
    if (!hash) return delayed(null);
    return delayed(Object.fromEntries(hash) as T);
  }

  /** Shared with the plain-key TTL map — a hash key and a plain key never
   * collide in practice (distinct key prefixes per caller), so one `ttls`
   * map for both is fine and keeps ttlOf() usable for hash-key assertions too. */
  async expire(key: string, seconds: number): Promise<number> {
    if (!this.store.has(key) && !this.hashes.has(key)) return delayed(0);
    this.ttls.set(key, seconds);
    return delayed(1);
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
