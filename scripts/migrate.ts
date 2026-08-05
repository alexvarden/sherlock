/**
 * Idempotent SQL migration runner.
 *
 * Applies every *.sql file in lib/db/migrations (sorted by name) that has not
 * already been recorded in the _migrations ledger table. Each file runs as a
 * single atomic transaction together with its ledger insert, so a half-applied
 * file can never be marked as done.
 *
 * Patterned on crane-ai's apps/web/scripts/migrate.ts. Sherlock deliberately
 * keeps its own copy rather than sharing that runner: Sherlock lives in its own
 * Neon project with its own SHERLOCK_DATABASE_URL, and that ledger belongs to
 * the newsletter database. Slight duplication, correct isolation — a bad
 * migration here can never reach the mailing list.
 *
 * Uses node-postgres over the pooled connection string, not the Neon serverless
 * driver: that one is HTTP-per-query, which is right for request handlers and
 * wrong for scripts.
 *
 *   npm run db:migrate
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = resolve(process.cwd(), "lib/db/migrations");

async function main() {
  const url = process.env.SHERLOCK_DATABASE_URL;
  if (!url) throw new Error("SHERLOCK_DATABASE_URL is not set");

  // Local Docker Postgres speaks plaintext; Neon requires TLS.
  const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(url);

  const client = new Client({
    connectionString: url,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const applied = new Set(
      (await client.query<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name)
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log("migrate: nothing to apply, schema is up to date");
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
      console.log(`migrate: applying ${file}`);
      // File + ledger insert in one simple-query batch = one atomic txn.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log(`migrate: applied ${pending.length} migration(s)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("migrate: failed");
  console.error(err);
  process.exit(1);
});
