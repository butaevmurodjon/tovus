import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

/** Lazy singleton so `next build` doesn't crash before env vars are provisioned. */
export function getRedis(): Redis {
  if (!_redis) {
    _redis = Redis.fromEnv();
  }
  return _redis;
}
