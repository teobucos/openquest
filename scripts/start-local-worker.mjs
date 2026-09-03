import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  unstable_getMiniflareWorkerOptions,
  unstable_splitSqlQuery,
} from "wrangler";

// Use the generated deployment config rather than the source config. The Vite
// plugin rewrites its assets directory to dist/client, which is the route the
// deployed Worker uses for the control-center SPA.
const { workerOptions } = unstable_getMiniflareWorkerOptions("dist/openquest/wrangler.json");
const { modulesRules, ...runtimeOptions } = workerOptions;
const port = Number.parseInt(process.env.OPENQUEST_PORT ?? "4178", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("OPENQUEST_PORT must be a valid TCP port.");
}

const persistencePath = process.env.OPENQUEST_PERSIST_PATH?.trim();
const sharedOptions = persistencePath
  ? { resourcePersistencePath: resolve(persistencePath, "v3") }
  : {};
const publicUrlValue = process.env.OPENQUEST_PUBLIC_URL?.trim();
const publicUrl = publicUrlValue ? new URL(publicUrlValue) : undefined;
if (publicUrl && !["http:", "https:"].includes(publicUrl.protocol)) {
  throw new Error("OPENQUEST_PUBLIC_URL must use HTTP or HTTPS.");
}
const publicOriginsValue = process.env.OPENQUEST_PUBLIC_ORIGINS?.trim();
if (publicOriginsValue) {
  for (const origin of publicOriginsValue.split(",")) {
    const trimmed = origin.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("OPENQUEST_PUBLIC_ORIGINS entries must use HTTP or HTTPS.");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("OPENQUEST_PUBLIC_ORIGINS entries must use HTTP or HTTPS.");
    }
  }
}
const miniflare = new Miniflare({
  ...convertV4MiniflareOptions({
    workers: [{
      ...runtimeOptions,
      bindings: {
        ...runtimeOptions.bindings,
        ...(publicUrl ? { OPENQUEST_PUBLIC_ORIGIN: publicUrl.origin } : {}),
        ...(publicOriginsValue ? { OPENQUEST_PUBLIC_ORIGINS: publicOriginsValue } : {}),
      },
      modules: true,
      name: "openquest-local",
      scriptPath: "index.js",
    }],
  }),
  ...sharedOptions,
  host: "127.0.0.1",
  port,
  publicUrl: publicUrl?.href,
});

if (process.env.OPENQUEST_MIGRATIONS !== "external") {
  const database = await miniflare.getD1Database("DB");
  for (const migration of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(`migrations/${migration}`, "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) {
      await database.prepare(statement).run();
    }
  }
}

const address = await miniflare.ready;
console.log(`OpenQuest local Worker listening at ${address}`);

const stop = async () => {
  await miniflare.dispose();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise(() => {});
