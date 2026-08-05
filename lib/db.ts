/**
 * Postgres access for the request path.
 *
 * Two drivers behind one function, chosen by connection string:
 *
 *   Neon      @neondatabase/serverless over HTTP. No connection to hold open,
 *             which is what serverless handlers need — they cannot keep a pool
 *             warm between invocations.
 *   Local     node-postgres. The Neon HTTP driver speaks to Neon's own HTTP
 *             endpoint, NOT the Postgres wire protocol, so it cannot talk to
 *             the Docker container at all (`fetch failed`). Verified, not
 *             assumed — an earlier version of this file claimed otherwise.
 *
 * Both expose the same `query(text, params) -> rows` shape, so callers never
 * branch. Placeholders are $1/$2 in both cases.
 *
 * NOT for bulk work. scripts/load-canon.ts and scripts/migrate.ts open their
 * own pg connection: one HTTP round trip per query would turn a 29k-row ingest
 * into tens of thousands of sequential requests.
 */

import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";

export type Query = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<T[]>;

let cached: Query | null = null;

function isLocal(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);
}

export function getQuery(): Query {
  if (cached) return cached;

  const url = process.env.SHERLOCK_DATABASE_URL;
  if (!url) throw new Error("SHERLOCK_DATABASE_URL is not set");

  if (isLocal(url)) {
    // One pool per process, reused across requests by the module cache.
    const pool = new Pool({ connectionString: url, max: 4 });
    cached = (async <T>(text: string, params: unknown[] = []) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    }) as Query;
  } else {
    const sql = neon(url);
    cached = (async <T>(text: string, params: unknown[] = []) => {
      return (await sql.query(text, params)) as T[];
    }) as Query;
  }

  return cached;
}
