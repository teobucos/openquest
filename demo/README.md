# OpenQuest demo world (fixture v2)

Fixture v2 is the purpose-built synthetic network for the WebMCP submission
demo: five fictional organizations in five sectors (biomedical research,
climate adaptation, open-source infrastructure, education, cultural heritage),
exactly one Quest per organization, and a compact but credible work stream:

- 5 organizations, all `is_demo = 1`, `unverified`, no ROR IDs
- 5 Quests, all `is_demo = 1`, one per organization
- 25 Challenges: 10 open, 5 awaiting Review, 10 resolved
- 17 Contributions: 5 pending, 10 accepted, 2 challenged (retained reopen history)
- 12 Reviews: 10 supporting, 2 challenging
- 12 Demo Agent contributor identities
- 59 public events with sequence #1–#59 immediately after rebuild

All records are synthetic demo content. A demo organization is not a real
organization and its affiliation is not a real verification; the UI shows a
clear `DEMO` badge for this provenance. Evidence links are stable public
standards or `example.com` synthetic references — citations, never
endorsements — and OpenQuest never fetches them server-side. The Arcfield
Quest covers research-method reporting only (no medical advice).

`demo/seed.sql` builds the world through the real database triggers and must
run on an empty database: plain `INSERT`s fail loudly if the world already
contains rows. `demo/reset.sql` empties every application table in foreign-key
order and resets the `events` sequence so the reseeded fixture starts at
event #1. `demo/expected-state.json` records the assertions above, and the
`demo:verify:*` commands query D1 and fail on any mismatch.

Direct `demo:seed:<target>` commands are for empty DBs only: each one first
runs `scripts/assert-demo-empty.mjs <target>`, which refuses before writing
when any of the 8 application tables is non-empty — run
`demo:rebuild:<target>` instead. Remote prep must use `demo:rebuild:remote`
(double-guarded); direct `demo:seed:remote` is for empty DBs only.

## Rebuild (deliberately destructive)

Rebuild is a guarded maintenance operation, never part of normal deployment:

```bash
bun scripts/reset-demo-world.mjs --target local    # reset -> seed -> verify
bun scripts/reset-demo-world.mjs --target serve    # persistent service state
```

Remote rebuild requires explicit double confirmation (see the wrapper usage).
Normal `deploy` never resets, seeds, or wipes data.

Runbook: stop/quiesce the service, close browser sessions, back up the exact
persistent D1 state once before the first destructive production rebuild
(example: `cp -r <OPENQUEST_PERSIST_PATH> <backup-path>`) and keep the backup
until the final demo state is accepted, then reset, seed, verify, restart,
run health checks, then open fresh browsers. The realtime
client treats event freshness as monotonic, so browsers must be opened fresh
after a sequence reset — never reset underneath live sessions.

## Local setup

```bash
bun run demo:migrate:local
bun scripts/reset-demo-world.mjs --target local
bun run dev
```

## After rebuild

The event sequence is #1–#59. Live human or agent actions after rebuild are
real runtime records: they advance the sequence past #59 and move Challenges
through the same state machine the fixture exercised. That is the point — the
fixture is the starting grid, not a frozen exhibit.
