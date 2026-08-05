# Seed dump

Anything in this directory is run by the Postgres container **once**, on first
boot of an empty `postgres_data` volume (`/docker-entrypoint-initdb.d`). Files
are applied in filename order; `.sql` and `.sql.gz` are both accepted.

The point is that `docker compose up` yields a populated graph with no
re-ingest and no API keys — this repo is public and should stay one-command
runnable.

## Regenerating the dump

After a clean `npm run db:load` against the local database:

```sh
docker exec sherlock-postgres-1 \
  pg_dump -U postgres -d sherlock --no-owner --no-privileges \
  | gzip -9 > data/seed/01-canon.sql.gz
```

Commit the result. It is a build artifact, but a deliberately committed one.
Gzipped because the raw dump is ~9.5 MB against ~1.7 MB compressed, and this
repo is public; the entrypoint handles `.sql.gz` natively.

The dump includes the `_migrations` ledger, so a seeded database already knows
`0001_graph.sql` is applied and `npm run db:migrate` correctly no-ops.

## Re-seeding

The init scripts only run on an empty volume. To force a rebuild:

```sh
docker compose rm -sf postgres && docker volume rm sherlock_postgres_data
docker compose up -d postgres
```

## Note

`data/processed/*.json` remains the source of truth for the canon — this dump
is a convenience so a fresh clone doesn't have to re-ingest. If the two ever
disagree, the JSON wins and the dump should be regenerated.
