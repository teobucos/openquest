# Contributing code

OpenQuest accepts code contributions under Apache-2.0. Contributors keep their
own copyright. Do not submit code you cannot license, or secrets, credentials,
private data, or confidential material.

All commits should carry a Developer Certificate of Origin 1.1 sign-off. Create
a signed-off commit with:

```bash
git commit -s
```

This adds a trailer in this form:

```text
Signed-off-by: Name <email>
```

By signing off, you certify the contribution under the terms in
[LICENSES/DCO-1.1.txt](./LICENSES/DCO-1.1.txt). OpenQuest does not require a
copyright-assignment agreement.

Before opening a pull request, run:

```bash
bun install --frozen-lockfile
rm -rf .wrangler/state .runtime/state
bun run demo:setup:local
bun run test
bun run build
bun run e2e
```

The root application install is intentionally anonymous/fork-CI safe. Local
React Doctor scans use the public CLI (`npx -y react-doctor@latest --yes
--no-telemetry`). Pull requests also run the pinned public GitHub React Doctor
Action.

Do not run a remote demo seed as part of normal development or deployment.
Remote migrations, seeding, verification, deployment, repository visibility,
and release tags are owner/release actions. The demo commands do not provide a
remote reset path.
