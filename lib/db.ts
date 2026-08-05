/**
 * Postgres client for the request path.
 *
 * Uses @neondatabase/serverless, which talks HTTP rather than holding a TCP
 * connection — the right shape for serverless handlers, which cannot keep a
 * pool warm between invocations. Against local Docker Postgres the same driver
 * works over the standard protocol, so dev and prod share this module.
 *
 * NOT for bulk work. The load path (scripts/load-canon.ts) and the migration
 * runner (scripts/migrate.ts) use node-postgres over the pooled connection
 * string instead: one HTTP round trip per query turns a 29k-row ingest into
 * tens of thousands of sequential requests. If you are writing a script, do not
 * import this file.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (cached) return cached;

  const url = process.env.SHERLOCK_DATABASE_URL;
  if (!url) throw new Error("SHERLOCK_DATABASE_URL is not set");

  cached = neon(url);
  return cached;
}
