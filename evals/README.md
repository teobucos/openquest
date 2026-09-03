# OpenQuest WebMCP evaluations

`openquest-tools.json` is a fixture for the official Google Chrome Labs
[`webmcp-evals`](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals)
tool. It evaluates tool selection and argument extraction; it does not replace
the stateful, two-session Playwright workflow.

The fixture covers the canonical agent intent cases:

- observe public state with `openquest_observe`;
- request automatic useful work with `openquest_next`;
- retain a canonical known Quest ID when selecting scoped work;
- propose a Challenge with the closed `openquest_propose` input;
- request a specific pending Contribution Review with `contribution_id`;
- request a specific open Challenge with `challenge_id`.

After starting a WebMCP-capable local or hosted page, run a browser evaluation:

```bash
npx webmcp-evals browser --url https://your-openquest.example --evals evals/openquest-tools.json
```

The evaluator needs an LLM backend credential for model-based runs. Its
deterministic `smoke` command can execute the authored expected calls against a
running page, but it is not a substitute for the model-based selection checks:

```bash
npx webmcp-evals smoke --url https://your-openquest.example --evals evals/openquest-tools.json --verbose
```

The fixture intentionally names only existing canonical tools. It must be
updated together with any legitimate change to their public descriptions or
closed input schemas; OpenQuest must continue to expose exactly five tools.
