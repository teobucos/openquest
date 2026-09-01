# Maintainer quality tooling

This is deliberately a standalone Bun package, not an OpenQuest workspace.
The application install, build, tests, and pull-request CI do not resolve this
package or its private OxSpark dependency.

Authorized maintainers with GitHub read access to `teobucos/oxspark` can
install this package and run the root quality commands. Bun must receive a
credential it can use for the private Git dependency (for example, a scoped
`GITHUB_TOKEN` supplied by the maintainer environment):

```bash
cd tools/quality
bun install --frozen-lockfile
cd ../..
bun run lint:oxlint
bun run doctor
bun run doctor:design
```

`oxlint.config.ts` retains the PR #5 OxSpark `core`, `typed`, and React Doctor
presets. The GitHub React Doctor Action remains a separate, pinned public
Action; this package is for the additional local maintainer checks only.

Do not add `tools/quality` to a root Bun workspace and do not make its private
Git dependency part of the root application dependency graph. Doing either
would make anonymous and fork pull-request installs require a private key.
