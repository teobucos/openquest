#!/usr/bin/env bun
// scripts/assert-demo-empty.mjs
//
// Pre-seed guard for direct `demo:seed:<target>` commands.
//
// demo/seed.sql uses plain INSERTs and must run on an empty database: it
// only fails on duplicate IDs, not on unrelated old/live rows. Running it
// against a dirty DB would silently append the fixture to existing content.
// This guard queries the 8 application tables and refuses (exit 1) when any
// row exists, pointing at the deterministic rebuild instead.
//
// Usage: bun scripts/assert-demo-empty.mjs local|serve|remote
//        (also accepts --target local|serve|remote)
//
// Target resolution mirrors scripts/reset-demo-world.mjs:
//   local    ephemeral local D1 state            (wrangler --local)
//   serve    persistent local-service D1 state   (wrangler --local --persist-to <path>)
//   remote   hosted D1 database                  (wrangler --remote)
//
// Serve persistence resolves ${OPENQUEST_PERSIST_PATH:-.runtime/state}, the
// same resolution used by scripts/start-local-worker.mjs and `bun run serve`.

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
    "Usage: bun scripts/assert-demo-empty.mjs local|serve|remote",
    "       bun scripts/assert-demo-empty.mjs --target local|serve|remote",
    "",
    "Refuses (exit 1) when any application table is non-empty.",
    "Serve uses ${OPENQUEST_PERSIST_PATH:-.runtime/state}.",
  ].join("\n");
}

function fail(message) {
  console.error(`assert-demo-empty: REFUSED — ${message}`);
  process.exit(1);
}

function parseTarget(argv) {
  const targetFlag = argv.indexOf("--target");
  if (targetFlag !== -1) {
    const value = argv[targetFlag + 1];
    if (value === undefined || value.startsWith("--")) fail(`--target requires a value.\n${usage()}`);
    return value;
  }
  const positional = argv.find((arg) => !arg.startsWith("--"));
  if (positional !== undefined) return positional;
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }
  fail(`missing target. ${usage()}`);
  return "";
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
  const target = parseTarget(process.argv.slice(2));

  if (!["local", "serve", "remote"].includes(target)) {
    fail(`ambiguous or unknown target "${target}" — use exactly local, serve, or remote.`);
  }

  const persistPath = resolvePersistPath();
  const d1Args = targetArgs(target, persistPath);
  const env = { ...process.env, OPENQUEST_PERSIST_PATH: persistPath };

  console.log(`assert-demo-empty: checking ${target} for existing rows...`);
  if (target === "serve") console.log(`  persist path: ${persistPath}`);

  const counts = await runJson(
    "bun",
    ["run", "--bun", "wrangler", "d1", "execute", "openquest", ...d1Args, "--json", "--command", EMPTY_CHECK_SQL],
    env,
  );
  const nonEmpty = APP_TABLES.filter((table) => counts[table] !== 0);
  if (nonEmpty.length > 0) {
    fail(
      `target "${target}" is not empty — non-empty tables: ${nonEmpty.map((t) => `${t}=${counts[t]}`).join(", ")}. `
      + `Direct seed would silently append to existing rows. Run bun run demo:rebuild:${target} instead.`,
    );
  }
  console.log("assert-demo-empty: empty verified (reviews, contributions, events, challenges, quests, organizations, rate_limits, sessions all 0).");
}

try {
  await main();
} catch (error) {
  console.error(`assert-demo-empty: FAILED — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
