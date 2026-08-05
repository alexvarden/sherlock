# Parity fixtures — frozen baseline

These files record what the **Neo4j** query layer returned for 273 queries across
all 17 canon works, captured on 2026-08-05 immediately before the Postgres
migration. `npm run parity:check` replays those queries against the current SQL
implementation and compares canonical hashes.

```
manifest.json   every query, its arguments, and a hash of its result
stories.json    listStories() in full — it encodes the canon filter and the
                in-universe ordering, both of which are easy to break quietly
full/*.json     complete payloads for three representative works, so a failing
                hash can be turned into an actual diff
```

## This baseline can no longer be regenerated

The capture script and the Neo4j implementation it drove were deleted in Stage 5
of the migration, along with the `neo4j` service in `docker-compose.yml` and the
`neo4j-driver` dependency. Aura is decommissioned. **There is no longer anything
that can produce these numbers.**

That is deliberate. The fixtures exist to prove one specific claim — that moving
from Cypher to SQL changed no output — and that claim has been proven. They are a
migration artifact with a finite life, not a permanent test suite.

## What to do when it starts failing

`parity:check` compares against a snapshot of a system that no longer exists, so
there are only two honest reasons for a failure:

**A regression in the query layer.** Fix the query layer. This is the case the
fixtures exist for, and it stays valuable as long as `lib/graph-query.ts` is
being changed.

**The canon data changed.** Re-ingesting, re-extracting, or reconciling entities
moves the underlying numbers, and the fixtures become stale in a way that cannot
be corrected — regenerating them would require Neo4j. At that point the parity
gate has expired: **delete `data/parity/`, `scripts/compare-parity.ts`,
`scripts/diff-parity.ts`, `scripts/parity-canonical.ts` and the `parity:check`
script.** Do not "fix" it by recapturing against the SQL implementation. A
baseline captured from the system under test proves nothing, and leaving one in
place is worse than having no gate at all, because it looks like coverage.

If the canon changes and you still want a regression check, that is a different
tool: snapshot the SQL output deliberately and call it a snapshot test, not
parity.

## Related

- `scripts/compare-parity.ts` — the gate
- `scripts/parity-canonical.ts` — the normalisation both sides used, and why
- `scripts/diff-parity.ts` — turns a failing `getStoryData` hash into a diff
