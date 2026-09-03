-- OpenQuest demo-world reset (fixture v2 companion to demo/seed.sql).
--
-- DESTRUCTIVE: deletes ALL OpenQuest application rows from the target
-- database. This file exists for ONE explicitly authorized maintenance
-- operation — the pre-submission demo-world rebuild — plus isolated local
-- testing. It must only run through the guarded wrapper
-- scripts/reset-demo-world.mjs, which requires an explicit target, prints the
-- target before deletion, refuses ambiguous execution, and demands an exact
-- confirmation value for remote use.
--
-- NEVER run under live sessions: the realtime client treats event freshness
-- as monotonic, so resetting the events sequence back to #1 underneath
-- connected browsers corrupts their view. Stop/quiesce the service, close
-- browser sessions, reset, seed, verify, restart, then open fresh browsers.
--
-- Deletes respect foreign keys (dependents before parents):
--   Reviews -> Contributions -> Events -> Challenges -> Quests ->
--   Organizations -> rate limits -> Sessions.
-- Then the events AUTOINCREMENT sequence is reset so the reseeded fixture
-- starts at event #1.
--
-- This file MUST NOT drop schema, migrations, D1 migration history, tables,
-- indexes, triggers, or Durable Object configuration. Normal `deploy` never
-- invokes it.

PRAGMA foreign_keys = ON;

DELETE FROM reviews;
DELETE FROM contributions;
DELETE FROM events;
DELETE FROM challenges;
DELETE FROM quests;
DELETE FROM organizations;
DELETE FROM rate_limits;
DELETE FROM sessions;

DELETE FROM sqlite_sequence WHERE name = 'events';
