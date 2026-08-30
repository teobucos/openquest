export interface ActorIdentity {
  id: string;
  label: string;
}

export interface EnsuredIdentity {
  actor: ActorIdentity;
  setCookie: string | null;
}

const sessionCookie = "oq_session";
const sessionPattern = /^[0-9a-f-]{36}$/;

interface IdRow {
  id: string;
}

interface CountRow {
  count: number;
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...values] = part.trim().split("=");
    if (key === name) return values.join("=");
  }
  return null;
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
    || request.headers.get("x-forwarded-proto") === "https";
}

function sessionSetCookie(token: string, request: Request): string {
  const secure = secureRequest(request) ? "Secure; " : "";
  return `${sessionCookie}=${token}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=31536000`;
}

export function publicActorLabel(sessionId: string): string {
  return `Agent ${sessionId.replaceAll("-", "").slice(-6).toUpperCase()}`;
}

export async function readIdentity(request: Request, db: D1Database): Promise<ActorIdentity | null> {
  const token = cookieValue(request, sessionCookie);
  if (!token || !sessionPattern.test(token)) return null;
  const tokenHash = await hashText(`openquest-session:${token}`);
  const session = await db.prepare("SELECT id FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<IdRow>();
  return session ? { id: session.id, label: publicActorLabel(session.id) } : null;
}

export async function ensureIdentity(request: Request, db: D1Database): Promise<EnsuredIdentity> {
  const existing = await readIdentity(request, db);
  const now = new Date().toISOString();
  if (existing) {
    await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
      .bind(now, existing.id)
      .run();
    return { actor: existing, setCookie: null };
  }

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const tokenHash = await hashText(`openquest-session:${token}`);
  await db.prepare(
    "INSERT INTO sessions (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
  ).bind(id, tokenHash, now, now).run();
  return {
    actor: { id, label: publicActorLabel(id) },
    setCookie: sessionSetCookie(token, request),
  };
}

async function hashAddress(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "local";
  return (await hashText(`openquest-address:${address}`)).slice(0, 24);
}

export async function enforceWriteLimit(
  request: Request,
  db: D1Database,
  actor: ActorIdentity,
): Promise<boolean> {
  const window = Math.floor(Date.now() / 60_000);
  const ipHash = await hashAddress(request);
  const sessionKey = `session:${actor.id}`;
  const addressKey = `ip:${ipHash}`;
  const statement = db.prepare(
    "INSERT INTO rate_limits (bucket_key, window, request_count) VALUES (?, ?, 1) "
      + "ON CONFLICT(bucket_key) DO UPDATE SET request_count = CASE "
      + "WHEN rate_limits.window = excluded.window THEN rate_limits.request_count + 1 ELSE 1 END, "
      + "window = excluded.window",
  );
  await db.batch([
    statement.bind(sessionKey, window),
    statement.bind(addressKey, window),
  ]);
  const usage = await db.prepare(
    "SELECT MAX(request_count) AS count FROM rate_limits WHERE bucket_key IN (?, ?)",
  ).bind(sessionKey, addressKey).first<CountRow>();
  return (usage?.count ?? 0) <= 30;
}
