import { readFileSync, readdirSync } from "node:fs";
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
const miniflare = new Miniflare({
  ...convertV4MiniflareOptions({
    workers: [{
      ...runtimeOptions,
      modules: true,
      name: "openquest-live-test",
      scriptPath: "index.js",
    }],
  }),
  host: "127.0.0.1",
  port: 4178,
});

const database = await miniflare.getD1Database("DB");
for (const migration of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
  const sql = readFileSync(`migrations/${migration}`, "utf8");
  for (const statement of unstable_splitSqlQuery(sql)) {
    await database.prepare(statement).run();
  }
}

const address = await miniflare.ready;
console.log(`OpenQuest live Worker test server listening at ${address}`);

const stop = async () => {
  await miniflare.dispose();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise(() => {});
