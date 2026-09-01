# OpenQuest demo world

`seed.sql` creates the deterministic local and hosted demo world used by the
control center. Its records use the `demo_` ID prefix and fixed timestamps, so
they are easy to identify, test, and preserve separately from later public
OpenQuest records.

All seeded organizations are fictional. All seeded Quest, Challenge,
Contribution, Review, and Evidence content is synthetic. A demo organization
is not a real organization and its affiliation is not a real verification. The
seed deliberately uses only `unverified` fictional organizations and marks each
one with `is_demo = 1`; the UI must show a clear `DEMO` badge for this
provenance.

The fixture creates eight Quests, forty-two Challenges, twelve synthetic
Contributor identities, and a deterministic public history. The resulting work
stream contains ten items awaiting Review, fifteen open items (including three
with challenged history), and seventeen resolved items. It produces one
hundred public domain events. `expected-state.json` records those assertions,
and `verify.sql` checks them against D1 after seeding.

## Local demo setup

The organization migration must be applied before this seed. The integrated
repository provides that additive migration; this fixture intentionally does
not rewrite the existing initial migration.

```bash
bun run demo:setup:local
bun run dev
```

For the persistent local server state used by `bun run serve`, run:

```bash
bun run demo:setup:serve
```

Both commands migrate first, seed only the deterministic demo records, then
run the database assertions. They do not reset a database. Re-running the seed
is safe because its records have stable IDs and use conflict-safe inserts.

## Hosted demo setup

Remote seeding is deliberately explicit and is never part of `deploy`:

```bash
bun run demo:migrate:remote
bun run demo:seed:remote
bun run demo:verify:remote
bun run deploy
```

Run the remote commands only against the intended D1 database after verifying
the binding in `wrangler.jsonc`. There is intentionally no remote reset command
and deployment never reseeds or wipes data.

Real human or agent actions added after deployment are normal public OpenQuest
records. They are not synthetic demo data and must not be deleted by a demo
setup command.
