# OpenQuest release handoff checklist

This is an owner-operated release checklist, not a claim that a release has
occurred. Every box below is deliberately unchecked until its named owner has
recorded the evidence for the target deployment.

## Repository verification

- [ ] Run `bun install --frozen-lockfile`, `bun run test`, `bun run build`,
  `bun run e2e`, and `bun run e2e:live` on the release commit.
- [ ] Confirm the deterministic demo migration, seed, and verification commands
  against the selected target without resetting public records.
- [ ] Review the release diff for the exactly five WebMCP tools and closed
  public inputs, including optional `openquest_next` Challenge/Contribution
  targeting that does not reserve work.
- [ ] Confirm session-isolation preflight: anonymous Observe is `viewer: null`,
  the first write establishes `SESSION · <public label>`, and two agents that
  share a cookie show the same label.
- [ ] Record the Chrome / ChatGPT in-app / agent-harness matrix from
  `WEBMCP_TESTING.md` rather than treating Playwright's fake `document.modelContext`
  as native WebMCP evidence.

## External deployment and public-operation gates

- [ ] Owner creates and binds the intended production D1 database and Durable
  Object migration in `wrangler.jsonc`.
- [ ] Owner applies remote migrations, deliberately seeds the fictional demo
  once, verifies it, and deploys the Worker.
- [ ] Owner records the HTTPS deployment URL and verifies its WebSocket upgrade
  and reconnect behavior in the deployed environment.
- [ ] Owner uses a WebMCP-capable native browser to inspect and invoke all five
  tools; Playwright's fake runtime is not evidence for this gate.
- [ ] Owner completes the two genuinely isolated-session contribution, Review,
  Result, and live-update walkthrough on the deployed URL.
- [ ] Owner checks public content, evidence links, responsive views, and the
  fictional `DEMO` organization labeling on the deployed control center.
- [ ] Owner reviews repository files and history for secrets and decides whether
  and when the repository may be made public.

## Submission artifacts

- [ ] Owner records the required public/native/browser evidence and any timing
  observations from the walkthrough.
- [ ] Owner records or publishes the required product video.
- [ ] Owner creates the intended release tag and release notes only after the
  preceding gates have evidence.

## Demo-world maintenance rebuild (guarded, one-time)

Destructive reset is a maintenance operation only. Normal `deploy` never
resets, seeds, or wipes data, and no HTTP route triggers a reset. Event
freshness sequences are monotonic within a browser session, so a reset that
renumbers events back to #1 must never run under live judges or demo agents:
stop/quiesce the service and close browser sessions first, and never re-run
after the submission freeze.

- [ ] Owner records the current deployed commit (`git rev-parse HEAD`).
- [ ] Owner stops/quiesces the demo service and closes existing demo browser
  sessions where practical.
- [ ] Owner backs up the current D1 persistent state once before the
  destructive reset (do not restore old content unless the rebuild fails).
- [ ] Owner runs the guarded rebuild against the exact service persistence
  path (resolve `OPENQUEST_PERSIST_PATH`; default `.runtime/state`):
  `OPENQUEST_PERSIST_PATH=<exact-service-path> bun run demo:rebuild:serve`
  (remote hosted D1 additionally requires `--confirm DESTROY-DEMO-WORLD`
  plus `OPENQUEST_DEMO_CONFIRM=DESTROY-DEMO-WORLD`).
- [ ] Owner confirms the wrapper printed the exact target before deletion,
  verified all application tables empty, seeded, and passed verification.
- [ ] Owner restarts the service and runs asset/API/live health verification
  (`bun scripts/verify-deployment.mjs <URL>`).
- [ ] Owner opens a clean browser and confirms `LIVE`, exactly five WebMCP
  tools, 5 Quests, 10 Open, 5 Needs Review, 10 Resolved, 12 Contributors,
  59 Public Events, Latest Event #59.
