import { useMemo, useState, type FormEvent, type MouseEvent } from "react";
import { createQuest } from "../api";
import type { ObserveResponse } from "../contracts";
import { readableError } from "../useRemoteData";
import type { WebMCPToolsState } from "../useWebMCPTools";
import { ChallengeInspector } from "./ChallengeInspector";
import type { RouteState, WorkFilter } from "./navigation";

type LiveStatus = "connecting" | "live" | "reconnecting" | "degraded";

const filters: Array<{ label: string; value: WorkFilter }> = [
  { label: "ALL", value: "all" },
  { label: "NEEDS REVIEW", value: "review" },
  { label: "OPEN", value: "open" },
  { label: "RESOLVED", value: "resolved" },
];

function isPlainInternalClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}

function LiveIndicator({ status, error }: { status: LiveStatus; error: string | null }) {
  const label = error ? "DEGRADED" : status.toUpperCase();
  return <span className={`live-indicator is-${error ? "degraded" : status}`} role="status" title={error ?? label}>{label}</span>;
}

function ToolStatus({ tools }: { tools: WebMCPToolsState }) {
  const label = tools.error
    ? "WebMCP · registration failed"
    : tools.registered
      ? "WebMCP · 5 tools ready"
      : tools.supported
        ? "WebMCP · registering"
        : "WebMCP · browser unsupported";
  return <span className={`tool-status${tools.registered ? " is-ready" : ""}`} title={tools.error ?? label}><span className="status-dot" />{label}</span>;
}

function timestamp(value: string) {
  return new Date(value).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
}

function streamLabel(state: ObserveResponse["work_stream"][number]["stream_state"]) {
  if (state === "review") return "NEEDS REVIEW";
  if (state === "resolved") return "RESULT";
  return "OPEN";
}

function CreateQuestForm({ onCreated }: { onCreated: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const fields = new FormData(event.currentTarget);
    try {
      const result = await createQuest({
        title: String(fields.get("title") ?? ""),
        goal: String(fields.get("goal") ?? ""),
        description: String(fields.get("description") ?? ""),
      });
      onCreated(result.slug);
    } catch (cause) {
      setMessage(readableError(cause));
      setSubmitting(false);
    }
  }
  return (
    <details className="create-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span>CREATE A QUEST</span><span aria-hidden="true">+</span></summary>
      <form className="quest-form" onSubmit={submit}>
        <p className="create-safety">Everything on OpenQuest is public. Do not submit confidential, proprietary, personal, credential, or secret information.</p>
        <label>Title<input name="title" required minLength={3} maxLength={160} /></label>
        <label>Goal<textarea name="goal" required minLength={10} maxLength={2_000} /></label>
        <label>Description<textarea name="description" maxLength={6_000} /></label>
        <button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create Quest"}</button>
        {message ? <p className="form-error" role="alert">{message}</p> : null}
      </form>
    </details>
  );
}

export function ControlCenter({
  data,
  tools,
  route,
  navigate,
  refreshError,
  liveStatus = "connecting",
}: {
  data: ObserveResponse;
  tools: WebMCPToolsState;
  route: RouteState;
  navigate: (route: RouteState) => void;
  refreshError: string | null;
  liveStatus?: LiveStatus;
}) {
  const scopedQuest = route.scope.kind === "quest" ? data.quests[0] : null;
  const visibleWork = useMemo(() => route.filter === "all"
    ? data.work_stream
    : data.work_stream.filter((item) => item.stream_state === route.filter), [data.work_stream, route.filter]);
  const scopeRoute = (patch: Partial<Pick<RouteState, "filter" | "challengeId">>): RouteState => ({ ...route, ...patch });
  const eventCount = data.freshness.event_count;
  const scopeTitle = scopedQuest ? `OPENQUEST / ${scopedQuest.title}` : "OPENQUEST CONTROL CENTER";

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" onClick={(event) => { if (!isPlainInternalClick(event)) return; event.preventDefault(); navigate({ scope: { kind: "network" }, filter: "all", challengeId: null }); }} aria-label="OpenQuest network"><span className="brand-mark">OQ</span>OPENQUEST</a>
        <ToolStatus tools={tools} />
      </header>
      <main className="control-center">
        <section className="scope-header" aria-labelledby="scope-title">
          <div>
            {scopedQuest ? <a className="back-link" href="/" onClick={(event) => { if (!isPlainInternalClick(event)) return; event.preventDefault(); navigate({ scope: { kind: "network" }, filter: route.filter, challengeId: null }); }}>← WHOLE NETWORK</a> : null}
            <h1 id="scope-title">{scopeTitle}</h1>
            <p>{scopedQuest ? scopedQuest.goal : "Public work moving through the Quest primitive pipeline."}</p>
            {scopedQuest ? <div className="scope-provenance"><span>{scopedQuest.status.toUpperCase()} QUEST</span>{scopedQuest.organization ? <span>{scopedQuest.organization.is_demo ? "DEMO · " : ""}{scopedQuest.organization.name} · {scopedQuest.organization.category}</span> : <span>COMMUNITY QUEST</span>}</div> : null}
          </div>
          <div className="scope-actions"><LiveIndicator status={liveStatus} error={refreshError} /><span className="sync-stamp">LATEST EVENT #{data.freshness.last_sequence}</span></div>
        </section>

        <section className="telemetry-rail" aria-label="OpenQuest truthful totals">
          <Metric label="Open" detail="Challenges accepting work" value={data.totals.open} tone="attention" />
          <Metric label="Needs Review" detail="Pending Contributions" value={data.totals.awaiting_review} tone="review" />
          <Metric label="Resolved" detail="Accepted Contributions" value={data.totals.resolved} tone="active" />
          <Metric label="Contributors" detail="Durable public activity" value={data.contributor_count} tone="active" />
          <Metric label="Public Events" detail={`Latest event #${data.freshness.last_sequence}`} value={eventCount} tone="neutral" />
        </section>

        <div className="control-grid">
          <section className="ops-panel work-stream-panel" aria-labelledby="work-stream-title">
            <div className="panel-heading"><h2 id="work-stream-title">WORK STREAM</h2><span>{visibleWork.length} SHOWN</span></div>
            <div className="work-filters" aria-label="Filter work stream">
              {filters.map((filter) => <button key={filter.value} type="button" className={route.filter === filter.value ? "is-selected" : ""} onClick={() => navigate(scopeRoute({ filter: filter.value }))}>{filter.label}</button>)}
            </div>
            <div className="work-stream" aria-live="polite">
              {visibleWork.map((item) => (
                <button className="work-row" type="button" key={`${item.stream_state}-${item.challenge.id}`} data-state={item.stream_state} onClick={() => navigate(scopeRoute({ challengeId: item.challenge.id }))}>
                  <span className="work-state">{streamLabel(item.stream_state)}</span>
                  <span className="work-copy"><strong>{item.challenge.title}</strong><span>{route.scope.kind === "network" ? item.quest.title : item.challenge.description}</span>{item.contribution ? <small>{item.stream_state === "resolved" ? "RESULT: " : "CONTRIBUTION: "}{item.contribution.summary}</small> : null}</span>
                  <time dateTime={item.stream_state === "resolved" ? item.challenge.updated_at : item.challenge.created_at}>{timestamp(item.stream_state === "resolved" ? item.challenge.updated_at : item.challenge.created_at)}</time>
                </button>
              ))}
              {visibleWork.length === 0 ? <p className="empty-console">No work matches this filter.</p> : null}
            </div>
          </section>

          <section className="ops-panel activity-console" aria-labelledby="activity-title">
            <div className="panel-heading"><h2 id="activity-title">PUBLIC ACTIVITY</h2><span>LATEST EVENT #{data.freshness.last_sequence}</span></div>
            <div className="activity-list" data-testid="activity-list" aria-live="polite" aria-relevant="additions text">
              {data.activity.map((event) => <div className="activity-row" key={event.sequence}><span className="activity-icon">#{String(event.sequence).padStart(4, "0")}</span><div><strong>{event.summary}</strong><span className="activity-meta"><span>{event.actor_label ?? "OpenQuest"}</span><span>{event.event_type.replace(".", " / ")}</span></span></div><time dateTime={event.created_at}>{timestamp(event.created_at)}</time></div>)}
              {data.activity.length === 0 ? <p className="empty-copy">No public activity yet.</p> : null}
            </div>
          </section>

          <aside className="command-rail" aria-label="OpenQuest context">
            {route.scope.kind === "network" ? <QuestList data={data} route={route} navigate={navigate} /> : <QuestContext quest={scopedQuest} data={data} />}
            <section className="ops-panel contributor-panel"><div className="panel-heading"><h2>RECENT CONTRIBUTORS</h2><span>{data.contributor_count} TOTAL</span></div><div className="contributor-list">{data.recent_contributors.map((contributor) => <div className="contributor-row" key={contributor.actor_label}><span className="contributor-avatar">{contributor.actor_label.slice(-2)}</span><span className="contributor-copy"><strong>{contributor.actor_label}</strong><span>{contributor.last_summary}</span></span><span className="recent-badge">{contributor.activity_count} EVT</span></div>)}{data.recent_contributors.length === 0 ? <p className="empty-copy">No durable contributor activity yet.</p> : null}</div></section>
            <section className="ops-panel webmcp-panel"><div className="panel-heading"><h2>WEBMCP</h2><span>{tools.registered ? "READY" : "UNAVAILABLE"}</span></div><p className="agent-instruction">Use with an agent: “Help move this Quest forward.”</p><code>openquest_observe · openquest_next · openquest_submit · openquest_review · openquest_propose</code></section>
            {route.scope.kind === "network" ? <CreateQuestForm onCreated={(slug) => navigate({ scope: { kind: "quest", slug }, filter: "all", challengeId: null })} /> : null}
          </aside>
        </div>
      </main>
      <footer><span>Quest → Challenge → Contribution → Review → Resolved</span><span>Open source · Public work</span></footer>
      {route.challengeId ? <ChallengeInspector challengeId={route.challengeId} onClose={() => navigate(scopeRoute({ challengeId: null }))} /> : null}
    </div>
  );
}

function Metric({ label, detail, value, tone }: { label: string; detail: string; value: number; tone: string }) {
  return <div className="telemetry-cell" data-tone={tone}><span>{label}</span><small>{detail}</small><strong>{value}</strong></div>;
}

function QuestList({ data, route, navigate }: { data: ObserveResponse; route: RouteState; navigate: (route: RouteState) => void }) {
  return <section className="ops-panel quest-list-panel"><div className="panel-heading"><h2>QUESTS</h2><span>{data.quests.length} VISIBLE</span></div><div className="quest-list">{data.quests.map((quest) => <a className="quest-row" href={`/q/${quest.slug}`} key={quest.id} onClick={(event) => { if (!isPlainInternalClick(event)) return; event.preventDefault(); navigate({ scope: { kind: "quest", slug: quest.slug }, filter: route.filter, challengeId: null }); }}><strong>{quest.title}</strong><span>{quest.goal}</span><small>{quest.counts.open} OPEN · {quest.counts.awaiting_review} REVIEW · {quest.counts.resolved} RESOLVED</small></a>)}{data.quests.length === 0 ? <p className="empty-copy">No active Quests.</p> : null}</div></section>;
}

function QuestContext({ quest, data }: { quest: ObserveResponse["quests"][number] | null; data: ObserveResponse }) {
  if (!quest) return null;
  const results = data.work_stream.filter((item) => item.stream_state === "resolved").slice(0, 3);
  return <section className="ops-panel quest-context-panel"><div className="panel-heading"><h2>QUEST CONTEXT</h2><span>{quest.organization?.is_demo ? "DEMO" : quest.organization ? "PROVENANCE" : "COMMUNITY"}</span></div><p>{quest.description || quest.goal}</p>{quest.organization ? <p className="provenance-copy">{quest.organization.name} · {quest.organization.verification_status}{quest.organization.ror_id ? ` · ${quest.organization.ror_id}` : ""}</p> : null}<h3>RECENT RESULTS</h3>{results.map((item) => <p className="result-summary" key={item.challenge.id}>{item.contribution?.summary}</p>)}{results.length === 0 ? <p className="empty-copy">No accepted results yet.</p> : null}</section>;
}
