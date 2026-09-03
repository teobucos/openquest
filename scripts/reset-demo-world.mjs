#!/usr/bin/env bun
// scripts/reset-demo-world.mjs
//
// Guarded destructive demo-world rebuild for OpenQuest.
//
// This is a MAINTENANCE operation, not part of normal deploy. `bun run deploy`
// never invokes this script, and no HTTP route triggers a reset.
//
// Modes:
//   reset    delete all application rows, reset the events sequence, verify empty
//   rebuild  reset -> seed demo/seed.sql -> run scripts/verify-demo-seed.mjs
//
// Targets:
//   local    ephemeral local D1 state            (wrangler --local)
//   serve    persistent local-service D1 state   (wrangler --local --persist-to <path>)
//   remote   hosted D1 database                  (wrangler --remote, double-guarded)
//
// Remote guard: requires BOTH the exact CLI flag
//   --confirm DESTROY-DEMO-WORLD
// and the matching environment variable
//   OPENQUEST_DEMO_CONFIRM=DESTROY-DEMO-WORLD
// Anything else (missing, mismatched, ambiguous target) refuses to run.
//
// Serve persistence: resolves ${OPENQUEST_PERSIST_PATH:-.runtime/state}, the same
// resolution used by `scripts/start-local-worker.mjs` and `bun run serve`. The
// resolved path is printed BEFORE deletion. Stop/quiesce the service first and
// confirm the service was started with the same OPENQUEST_PERSIST_PATH.
//
// Reset contract (demo/reset.sql, owned by the fixture author — this wrapper
// only reads it, never writes it):
//   ordered deletes honoring foreign keys —
//     reviews -> contributions -> events -> challenges -> quests ->
//     organizations -> rate_limits -> sessions —
//   plus `DELETE FROM sqlite_sequence WHERE name = 'events';` so the next
//   seeded fixture starts at event #1. Must NOT drop tables, indexes,
//   triggers, or D1 migration history.

const CONFIRM_PHRASE = "DESTROY-DEMO-WORLD";
const DEFAULT_RESET_FILE = "demo/reset.sql";
const DEFAULT_SEED_FILE = "demo/seed.sql";
const DEFAULT_VERIFY_SCRIPT = "scripts/verify-demo-seed.mjs";

const APP_TABLES = [
  "reviews",
  "contributions",
  "events",
  "challenges",
  "quests",
  "organizations",
  "rate_limits",
  "sessions",
];

const EMPTY_CHECK_SQL = `SELECT ${APP_TABLES.map(
  (table) => `(SELECT COUNT(*) FROM ${table}) AS ${table}`,
).join(", ")}`;

function usage() {
  return [
    "Usage: bun scripts/reset-demo-world.mjs --target local|serve|remote [--mode reset|rebuild]",
    "         [--reset-file demo/reset.sql] [--seed-file demo/seed.sql] [--confirm DESTROY-DEMO-WORLD]",
    "",
    "Modes: reset (delete + verify empty) or rebuild (reset -> seed -> verify). Default: rebuild.",
    `Remote requires --confirm ${CONFIRM_PHRASE} AND OPENQUEST_DEMO_CONFIRM=${CONFIRM_PHRASE}.`,
    "Serve uses ${OPENQUEST_PERSIST_PATH:-.runtime/state}; stop the service before resetting.",
  ].join("\n");
}

function fail(message) {
  console.error(`reset-demo-world: REFUSED — ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { mode: "rebuild", resetFile: DEFAULT_RESET_FILE, seedFile: DEFAULT_SEED_FILE };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--target" || flag === "--mode" || flag === "--confirm"
      || flag === "--reset-file" || flag === "--seed-file") {
      if (value === undefined || value.startsWith("--")) fail(`${flag} requires a value.\n${usage()}`);
      if (flag === "--target") args.target = value;
      else if (flag === "--mode") args.mode = value;
      else if (flag === "--confirm") args.confirm = value;
      else if (flag === "--reset-file") args.resetFile = value;
      else args.seedFile = value;
      i += 1;
    } else if (flag === "--help" || flag === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      fail(`unknown argument "${flag}".\n${usage()}`);
    }
  }
  return args;
}

function resolvePersistPath() {
  const raw = process.env.OPENQUEST_PERSIST_PATH?.trim();
  return raw ? raw : ".runtime/state";
}

function targetArgs(target, persistPath) {
  if (target === "local") return ["--local"];
  if (target === "serve") return ["--local", "--persist-to", persistPath];
  return ["--remote"];
}

async function runInherited(command, args, env) {
  const worker = Bun.spawn([command, ...args], {
    env,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await worker.exited;
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} exited with code ${exitCode}.`);
}

async function runJson(command, args, env) {
  const worker = Bun.spawn([command, ...args], {
    env,
    stderr: "inherit",
    stdout: "pipe",
  });
  const stdout = await new Response(worker.stdout).text();
  const exitCode = await worker.exited;
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} exited with code ${exitCode}.`);
  const parsed = JSON.parse(stdout);
  const first = Array.isArray(parsed) ? parsed[0] : parsed?.result?.[0] ?? parsed;
  const row = first?.results?.[0];
  if (!row) throw new Error(`Unexpected JSON shape from ${command} ${args.join(" ")}: ${stdout.slice(0, 200)}`);
  return row;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.target) fail(`missing --target. ${usage()}`);
  if (!["local", "serve", "remote"].includes(args.target)) {
    fail(`ambiguous or unknown target "${args.target}" — use exactly local, serve, or remote.`);
  }
  if (!["reset", "rebuild"].includes(args.mode)) fail(`unknown mode "${args.mode}" — use reset or rebuild.`);

  const persistPath = resolvePersistPath();
  const d1Args = targetArgs(args.target, persistPath);
  const env = { ...process.env, OPENQUEST_PERSIST_PATH: persistPath };

  const resetFile = Bun.file(args.resetFile);
  if (!(await resetFile.exists())) {
    fail(
      `reset file "${args.resetFile}" is missing. Expected contract at demo/reset.sql: ordered deletes `
      + `(reviews -> contributions -> events -> challenges -> quests -> organizations -> rate_limits -> sessions) `
      + `plus DELETE FROM sqlite_sequence WHERE name = 'events'; schema, indexes, triggers, and D1 migration `
      + `history must be preserved. Refusing to invent a destructive reset inline.`,
    );
  }

  // Print the exact target BEFORE any deletion.
  console.log("reset-demo-world: DESTRUCTIVE operation");
  console.log(`  target      : ${args.target}`);
  if (args.target === "serve") {
    console.log(`  persist path: ${persistPath}`);
    console.log("  Confirm the demo service was started with the same OPENQUEST_PERSIST_PATH");
    console.log("  and that the service is stopped/quiesced with browser sessions closed");
    console.log("  (event freshness is monotonic — never reset under live judges).");
  }
  if (args.target === "remote") {
    console.log("  database    : hosted D1 (wrangler --remote)");
    if (args.confirm !== CONFIRM_PHRASE || process.env.OPENQUEST_DEMO_CONFIRM !== CONFIRM_PHRASE) {
      fail(
        `remote destructive reset requires BOTH --confirm ${CONFIRM_PHRASE} AND `
        + `OPENQUEST_DEMO_CONFIRM=${CONFIRM_PHRASE} with exactly matching values.`,
      );
    }
    console.log(`  confirmation: ${CONFIRM_PHRASE} (flag + env matched)`);
  }
  console.log(`  mode        : ${args.mode}`);
  console.log(`  reset file  : ${args.resetFile}`);

  console.log(`reset-demo-world: executing ${args.resetFile} against ${args.target}...`);
  await runInherited("bun", ["run", "--bun", "wrangler", "d1", "execute", "openquest", ...d1Args, "--file", args.resetFile], env);

  console.log("reset-demo-world: verifying all application tables are empty...");
  const counts = await runJson(
    "bun",
    ["run", "--bun", "wrangler", "d1", "execute", "openquest", ...d1Args, "--json", "--command", EMPTY_CHECK_SQL],
    env,
  );
  const nonEmpty = APP_TABLES.filter((table) => counts[table] !== 0);
  if (nonEmpty.length > 0) {
    throw new Error(
      `Reset verification failed — non-empty tables: ${nonEmpty.map((t) => `${t}=${counts[t]}`).join(", ")}.`,
    );
  }
  console.log("reset-demo-world: empty verified (reviews, contributions, events, challenges, quests, organizations, rate_limits, sessions all 0).");

  if (args.mode === "reset") {
    console.log(`reset-demo-world: reset complete for ${args.target}. No seed applied (mode=reset).`);
    return;
  }

  console.log(`reset-demo-world: seeding ${args.seedFile}...`);
  await runInherited("bun", ["run", "--bun", "wrangler", "d1", "execute", "openquest", ...d1Args, "--file", args.seedFile], env);

  console.log(`reset-demo-world: running fixture verification (${DEFAULT_VERIFY_SCRIPT} ${args.target})...`);
  await runInherited("bun", [DEFAULT_VERIFY_SCRIPT, args.target], env);

  console.log(`reset-demo-world: rebuild complete for ${args.target} (reset -> seed -> verify).`);
}

try {
  await main();
} catch (error) {
  console.error(`reset-demo-world: FAILED — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
