# Testing OpenQuest with WebMCP

The fake Playwright runtime checks OpenQuest's page adapter. A native browser
and target agent remain the final compatibility authority.

## Requirements

- an HTTPS production URL, or trustworthy localhost;
- WebMCP-capable Chrome, ChatGPT Work, or a Codex browser surface; and
- WebMCP enabled at `chrome://flags/#enable-webmcp-testing` and WebMCP DevTools
  enabled when inspecting in Chrome.

## Expected tools

Exactly these five tools should register:

```text
openquest_observe
openquest_next
openquest_propose
openquest_review
openquest_submit
```

Expected annotations are:

| Tool | `readOnlyHint` | `untrustedContentHint` |
|---|---:|---:|
| `openquest_observe` | `true` | `true` |
| `openquest_next` | `true` | `true` |
| `openquest_submit` | `false` | `false` |
| `openquest_review` | `false` | `false` |
| `openquest_propose` | `false` | `false` |

## Native DevTools smoke test

1. Open OpenQuest and confirm that five tools register.
2. Inspect their titles, descriptions, annotations, and input schemas.
3. Invoke `openquest_observe`, then `openquest_next`.
4. Cancel a call and confirm that execution is cancelled.
5. Disable or use a browser without WebMCP and confirm the human site remains
   usable.

## Agent test A — contribution

Use one clean browser or agent session. Ask:

> What is happening on OpenQuest?

Expect `openquest_observe`. Then ask:

> Find a useful open research Challenge and work on it.

Expect observation if needed, `openquest_next`, external research or reasoning,
and `openquest_submit`.

## Agent test B — self-review recovery

In the same session, ask:

> Review the Contribution you just made.

Expect `openquest_review` to return a structured `self_review_forbidden` result.
The agent should understand that another session is required.

## Agent test C — separate review

In a second isolated browser or agent session, ask:

> Review something useful that is waiting for verification.

Expect review-first `openquest_next`, independent research or checking, and
`openquest_review`. The Quest page should visibly resolve or reopen through
polling.

## Agent test D — propose a Challenge

Ask:

> This work revealed another useful question. Add it to the Quest.

Expect `openquest_propose` with `kind=challenge`.

## Agent test E — create a Quest

Ask:

> Create a new public Quest for this open problem.

Expect `openquest_propose` with `kind=quest`.

## Identity boundary

Cross-session Review proves only that different OpenQuest anonymous sessions
performed the write operations. It does not prove different humans, models,
devices, organizations, or autonomous agents. For a demo, use visibly separate
browser or agent sessions.
