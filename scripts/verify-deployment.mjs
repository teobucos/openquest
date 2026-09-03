import { randomBytes } from "node:crypto";
import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";

const targetArgument = process.argv[2] ?? process.env.OPENQUEST_DEPLOY_URL;
if (!targetArgument) throw new Error("Usage: bun scripts/verify-deployment.mjs <OpenQuest URL>");
const target = new URL(targetArgument);
if (!/^https?:$/.test(target.protocol)) throw new Error("Deployment target must use http or https.");
const rootUrl = new URL("/", target);

function contentType(response) { return (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase(); }
function isHtmlShell(body) { return /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(body); }
function assertOk(response, label) { if (!response.ok) throw new Error(`Expected ${label} to succeed but received HTTP ${response.status}.`); }
function sourceAttribute(tag, attribute) {
  const match = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`, "i").exec(tag);
  return match?.[1] ?? match?.[2];
}
function assetReferences(html) {
  const javascript = [...html.matchAll(/<script\b[^>]*>/gi)].map((tag) => sourceAttribute(tag[0], "src")).filter(Boolean);
  const stylesheet = [...html.matchAll(/<link\b[^>]*>/gi)].filter((tag) => /\brel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet)(?=\s|>|\/)/i.test(tag[0])).map((tag) => sourceAttribute(tag[0], "href")).filter(Boolean);
  if (javascript.length === 0 || stylesheet.length === 0) throw new Error("Deployment HTML must reference at least one JavaScript and one CSS asset.");
  return { javascript, stylesheet };
}
async function verifyAsset(path, expectedType, label) {
  const assetUrl = new URL(path, rootUrl);
  const response = await fetch(assetUrl);
  assertOk(response, `${label} asset ${assetUrl.pathname}`);
  const type = contentType(response);
  if (!expectedType.test(type)) throw new Error(`Expected ${label} asset ${assetUrl.pathname} but received ${type || "no content type"}.`);
  const body = await response.text();
  if (isHtmlShell(body)) throw new Error(`Expected ${label} asset ${assetUrl.pathname} but received the SPA HTML shell.`);
}
function verifyLiveUpgrade() {
  const secure = rootUrl.protocol === "https:";
  const port = Number(rootUrl.port || (secure ? 443 : 80));
  const socket = secure ? connectTls({ host: rootUrl.hostname, port, servername: rootUrl.hostname }) : connectTcp({ host: rootUrl.hostname, port });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error("Timed out waiting for /api/live WebSocket upgrade.")); }, 10_000);
    let response = "";
    const finish = (error) => { clearTimeout(timeout); socket.destroy(); error ? reject(error) : resolve(); };
    socket.once("error", (error) => finish(new Error(`Unable to connect to /api/live: ${error.message}`)));
    socket.once("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write([`GET /api/live HTTP/1.1`, `Host: ${rootUrl.host}`, `Origin: ${rootUrl.origin}`, "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13", "", ""].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (!response.includes("\r\n\r\n")) return;
      const [status, ...headers] = response.split("\r\n");
      const normalizedHeaders = headers.join("\n").toLowerCase();
      if (!/^HTTP\/1\.1 101\b/.test(status) || !/upgrade:\s*websocket/.test(normalizedHeaders)) return finish(new Error(`Expected /api/live WebSocket upgrade but received ${status || "an empty response"}.`));
      finish();
    });
  });
}

const htmlResponse = await fetch(rootUrl);
assertOk(htmlResponse, "deployment HTML");
if (!/\btext\/html\b/i.test(contentType(htmlResponse))) throw new Error(`Expected deployment HTML but received ${contentType(htmlResponse) || "no content type"}.`);
const html = await htmlResponse.text();
const assets = assetReferences(html);
for (const path of assets.javascript) await verifyAsset(path, /^(?:application|text)\/(?:javascript|ecmascript|x-javascript)$/, "JavaScript");
for (const path of assets.stylesheet) await verifyAsset(path, /^text\/css$/, "CSS");
const worldResponse = await fetch(new URL("/api/world", rootUrl));
assertOk(worldResponse, "/api/world");
if (!/\bapplication\/json\b/i.test(contentType(worldResponse))) throw new Error(`Expected /api/world JSON but received ${contentType(worldResponse) || "no content type"}.`);
const observation = await worldResponse.json();
if (!observation || !Array.isArray(observation.quests) || !Array.isArray(observation.activity) || !Array.isArray(observation.work_stream) || typeof observation.freshness?.last_sequence !== "number") throw new Error("/api/world did not return a valid OpenQuest observation response.");
await verifyLiveUpgrade();
console.log(`Deployment verification passed for ${rootUrl.origin}: ${assets.javascript.length} JavaScript asset(s), ${assets.stylesheet.length} CSS asset(s), /api/world, and /api/live.`);
