import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createQuest } from "../api";
import { Brand } from "../Brand";
import type { ObserveResponse } from "../contracts";
import { readableError } from "../useRemoteData";
import type { WebMCPToolsState } from "../useWebMCPTools";
import {
  SESSION_HELP_TEXT,
  WEBMCP_CHROME_DOCS_URL,
  WEBMCP_UNAVAILABLE_GUIDANCE,
  webMcpHeaderLabel,
  webMcpPanelLabel,
  webMcpRegistrationFact,
  webMcpSurfaceState,
} from "../webmcpStatus";
import { ChallengeInspector } from "./ChallengeInspector";
import {
  LIVE_EFFECT_MS,
  canonicalMetricDeltas,
  canonicalMetricSnapshot,
  changedWorkChallengeIds,
  dashboardScopeKey,
  emptyMetricDeltas,
  formatMetricDelta,
  type CanonicalMetricDeltas,
} from "./canonicalHighlights";
import type { RouteNavigationHandler, RouteState, WorkFilter } from "./navigation";

type LiveStatus = "connecting" | "live" | "reconnecting" | "degraded";

const filters: Array<{ label: string; value: WorkFilter }> = [
  { label: "ALL", value: "all" },
  { label: "NEEDS REVIEW", value: "review" },
  { label: "OPEN", value: "open" },
  { label: "RESOLVED", value: "resolved" },
];

const webMcpTools = [
  ["openquest_observe", "READ"],
  ["openquest_next", "READ"],
  ["openquest_submit", "WRITE"],
  ["openquest_review", "WRITE"],
  ["openquest_propose", "WRITE"],
] as const;

function LiveIndicator({ status, error }: { status: LiveStatus; error: string | null }) {
  const label = error ? "DEGRADED" : status.toUpperCase();
  return <span className={`live-indicator is-${error ? "degraded" : status}`} role="status" title={error ?? label}>{label}</span>;
}

function ToolStatus({ tools }: { tools: WebMCPToolsState }) {
  const state = webMcpSurfaceState(tools);
  const label = webMcpHeaderLabel(state);
  return <span className={`tool-status${tools.registered ? " is-ready" : ""}`} title={tools.error ?? label}><span className="status-dot" />{label}</span>;
}

function compactTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function streamLabel(state: ObserveResponse["work_stream"][number]["stream_state"]) {
  if (state === "review") return "NEEDS REVIEW";
  if (state === "resolved") return "RESULT";
  return "OPEN";
}

function demoPrefix(quest: { is_demo: boolean }): string {
  return quest.is_demo ? "DEMO · " : "";
}

function agentInitials(label: string): string {
  const demo = /^Demo Agent (\d{2})$/.exec(label);
  if (demo) return demo[1];
  const stripped = label.replace(/^Agent(?:-|\s)+/i, "").trim();
  return stripped.slice(0, 2).toUpperCase() || "AG";
}

interface CanonicalHighlights {
  readonly changedChallengeIds: ReadonlySet<string>;
  readonly deltas: CanonicalMetricDeltas;
  readonly latestEventSequence: number | null;
  readonly latestSequence: number | null;
}

const noHighlights: CanonicalHighlights = {
  changedChallengeIds: new Set(),
  deltas: emptyMetricDeltas,
  latestEventSequence: null,
  latestSequence: null,
};

function useCanonicalHighlights(data: ObserveResponse, scopeKey: string): CanonicalHighlights {
  const [highlights, setHighlights] = useState(noHighlights);
  const previous = useRef<{ data: ObserveResponse; scopeKey: string } | null>(null);
  const clearTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (clearTimer.current !== undefined) window.clearTimeout(clearTimer.current);
  }, []);

  useEffect(() => {
    const preceding = previous.current;
    previous.current = { data, scopeKey };
    if (!preceding || preceding.scopeKey !== scopeKey) {
      if (clearTimer.current !== undefined) window.clearTimeout(clearTimer.current);
      clearTimer.current = undefined;
      setHighlights(noHighlights);
      return;
    }
    if (data.freshness.last_sequence <= preceding.data.freshness.last_sequence) return;

    if (clearTimer.current !== undefined) window.clearTimeout(clearTimer.current);
    setHighlights({
      changedChallengeIds: changedWorkChallengeIds(preceding.data.work_stream, data.work_stream),
      deltas: canonicalMetricDeltas(canonicalMetricSnapshot(preceding.data), canonicalMetricSnapshot(data)),
      latestEventSequence: data.activity[0]?.sequence ?? null,
      latestSequence: data.freshness.last_sequence,
    });
    const timer = window.setTimeout(() => {
      if (clearTimer.current !== timer) return;
      clearTimer.current = undefined;
      setHighlights(noHighlights);
    }, LIVE_EFFECT_MS);
    clearTimer.current = timer;
  }, [data, scopeKey]);

  return highlights;
}

function CreateQuestForm({
  open,
  onCreated,
  onOpenChange,
}: {
  open: boolean;
  onCreated: (slug: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
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
    } catch (cause: unknown) {
      setMessage(readableError(cause));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <RailSection className="create-panel" title="CREATE A QUEST" open={open} onToggle={() => onOpenChange(!open)}>
      <div className="create-body">
        <p className="create-safety">Everything on OpenQuest is public. Do not submit confidential, proprietary, personal, credential, or secret information.</p>
        <form className="quest-form" onSubmit={submit}>
          <label>Title<input name="title" required minLength={3} maxLength={160} /></label>
          <label>Goal<textarea name="goal" required minLength={10} maxLength={2_000} /></label>
          <label>Description<textarea name="description" maxLength={6_000} /></label>
          <button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create Quest"}</button>
          {message ? <p className="form-error" role="alert">{message}</p> : null}
        </form>
      </div>
    </RailSection>
  );
}

export function ControlCenter({
  data,
  tools,
  route,
  navigate,
  onNavigate,
  refreshError,
  liveStatus = "connecting",
}: {
  data: ObserveResponse;
  tools: WebMCPToolsState;
  route: RouteState;
  navigate: (route: RouteState) => void;
  onNavigate: RouteNavigationHandler;
  refreshError: string | null;
  liveStatus?: LiveStatus;
}) {
  const [railOpen, setRailOpen] = useState({
    quests: true,
    contributors: false,
    webmcp: false,
    create: false,
  });
  const toggleRail = (id: "quests" | "contributors" | "webmcp" | "create") => {
    setRailOpen((current) => ({ ...current, [id]: !current[id] }));
  };
  const scopedQuest = route.scope.kind === "quest" && data.quests[0]?.slug === route.scope.slug
    ? data.quests[0]
    : null;
  const visibleWork = useMemo(() => route.filter === "all"
    ? data.work_stream
    : data.work_stream.filter((item) => item.stream_state === route.filter), [data.work_stream, route.filter]);
  const scopeRoute = (patch: Partial<Pick<RouteState, "filter" | "challengeId">>): RouteState => ({ ...route, ...patch });
  const scopeTitle = scopedQuest ? `OPENQUEST / ${scopedQuest.title}` : "OPENQUEST CONTROL CENTER";
  const scopeKey = dashboardScopeKey(route.scope, scopedQuest?.id ?? null);
  const highlights = useCanonicalHighlights(data, scopeKey);
  const challengeTotal = data.totals.open + data.totals.awaiting_review + data.totals.resolved;
  const reviewEvents = data.activity.filter((event) => event.event_type.startsWith("review.")).length;

  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand onClick={onNavigate({ scope: { kind: "network" }, filter: "all", challengeId: null })} />
        <div className="header-operations">
          <span className="header-context">{scopedQuest ? `QUEST / ${scopedQuest.title}` : "PUBLIC NETWORK / CONTROL ROOM"}</span>
          <ToolStatus tools={tools} />
        </div>
      </header>
      <main className="command-center" data-build-id={import.meta.env.VITE_OPENQUEST_BUILD_ID ?? "dev"}>
        <section className="command-summary" aria-labelledby="scope-title">
          <div className="command-kicker">
            {scopedQuest ? <a className="back-link" href="/" onClick={onNavigate({ scope: { kind: "network" }, filter: route.filter, challengeId: null })}>← WHOLE NETWORK</a> : null}
            <h1 id="scope-title">{scopeTitle}</h1>
            <p>{scopedQuest ? scopedQuest.goal : "Public work moving through the Quest primitive pipeline."}</p>
            {scopedQuest ? <div className="scope-provenance"><span>{scopedQuest.status.toUpperCase()} QUEST</span><span>{demoPrefix(scopedQuest)}{scopedQuest.organization ? `${scopedQuest.organization.name} · ${scopedQuest.organization.category}` : "COMMUNITY QUEST"}</span></div> : null}
          </div>
          <div className="command-actions">
            <LiveIndicator status={liveStatus} error={refreshError} />
            <span className={`sync-stamp${highlights.latestSequence === data.freshness.last_sequence ? " is-fresh" : ""}`} data-testid="latest-event-indicator">LATEST EVENT #{data.freshness.last_sequence}</span>
            {route.scope.kind === "network" ? <button className="compact-action" type="button" onClick={() => setRailOpen((current) => ({ ...current, create: true }))}>+ NEW QUEST</button> : null}
          </div>
        </section>

        <TelemetryRail data={data} deltas={highlights.deltas} />

        <div className="command-grid">
          <WorkStreamPanel
            highlights={highlights}
            navigate={navigate}
            route={route}
            scopeRoute={scopeRoute}
            totals={data.totals}
            visibleWork={visibleWork}
          />
          <ActivityPanel data={data} latestEventSequence={highlights.latestEventSequence} />
          <aside className="command-rail" aria-label="OpenQuest context">
            {route.scope.kind === "network"
              ? <QuestList data={data} route={route} onNavigate={onNavigate} open={railOpen.quests} onToggle={() => toggleRail("quests")} />
              : <QuestContext quest={scopedQuest} data={data} open={railOpen.quests} onToggle={() => toggleRail("quests")} />}
            <ContributorPanel data={data} open={railOpen.contributors} onToggle={() => toggleRail("contributors")} />
            <WebMcpPanel tools={tools} viewer={data.viewer} prompt={route.scope.kind === "quest" ? "Help move this Quest forward." : "Help with whatever is most useful."} open={railOpen.webmcp} onToggle={() => toggleRail("webmcp")} />
            {route.scope.kind === "network" ? <CreateQuestForm open={railOpen.create} onOpenChange={(open) => setRailOpen((current) => ({ ...current, create: open }))} onCreated={(slug) => navigate({ scope: { kind: "quest", slug }, filter: "all", challengeId: null })} /> : null}
          </aside>
          <section className="ops-panel primitive-pipeline" aria-labelledby="pipeline-title">
            <div className="panel-heading"><h2 id="pipeline-title">PRIMITIVE PIPELINE</h2><span>PUBLIC STATE FLOW</span></div>
            <div className="pipeline-flow">
              <div className="pipeline-stage"><span>Quest</span><strong>{data.quests.length}</strong><small>visible active directions</small></div>
              <div className="pipeline-stage"><span>Challenge</span><strong>{challengeTotal}</strong><small>all public work states</small></div>
              <div className="pipeline-stage"><span>Contribution</span><strong>{data.totals.awaiting_review}</strong><small>pending independent Review</small></div>
              <div className="pipeline-stage"><span>Review</span><strong>{reviewEvents}</strong><small>in current event window</small></div>
              <div className="pipeline-stage"><span>Resolved</span><strong>{data.totals.resolved}</strong><small>accepted Results</small></div>
            </div>
          </section>
        </div>
      </main>
      <footer><span>Quest → Challenge → Contribution → Review → Resolved</span><span>Open source · Public work</span></footer>
      {route.challengeId ? <ChallengeInspector challengeId={route.challengeId} onClose={() => navigate(scopeRoute({ challengeId: null }))} onQuestNavigate={(slug) => onNavigate({ scope: { kind: "quest", slug }, filter: route.filter, challengeId: null })} /> : null}
    </div>
  );
}

function TelemetryRail({ data, deltas }: { data: ObserveResponse; deltas: CanonicalMetricDeltas }) {
  return (
    <section className="telemetry-rail" aria-label="OpenQuest truthful totals">
      <Metric label="Open" metric="open" detail="Challenges accepting work" value={data.totals.open} delta={deltas.open} tone="attention" />
      <Metric label="Needs Review" metric="awaiting_review" detail="Pending Contributions" value={data.totals.awaiting_review} delta={deltas.awaiting_review} tone="review" />
      <Metric label="Resolved" metric="resolved" detail="Accepted Results" value={data.totals.resolved} delta={deltas.resolved} tone="active" />
      <Metric label="Contributors" metric="contributors" detail="Durable public activity" value={data.contributor_count} delta={deltas.contributor_count} tone="active" />
      <Metric label="Public Events" metric="events" detail={`Latest event #${data.freshness.last_sequence}`} value={data.freshness.event_count} delta={deltas.event_count} tone="neutral" />
    </section>
  );
}

function WorkStreamPanel({
  highlights,
  navigate,
  route,
  scopeRoute,
  totals,
  visibleWork,
}: {
  highlights: CanonicalHighlights;
  navigate: (route: RouteState) => void;
  route: RouteState;
  scopeRoute: (patch: Partial<Pick<RouteState, "filter" | "challengeId">>) => RouteState;
  totals: ObserveResponse["totals"];
  visibleWork: ObserveResponse["work_stream"];
}) {
  return (
    <section className="ops-panel work-stream-panel" aria-labelledby="work-stream-title">
      <div className="panel-heading"><h2 id="work-stream-title">WORK STREAM</h2><span>{visibleWork.length} SHOWN</span></div>
      <div className="work-lanes" aria-label="Available work queues">
        <button type="button" className={route.filter === "review" ? "is-selected" : ""} onClick={() => navigate(scopeRoute({ filter: "review" }))}>
          <span>REVIEW QUEUE</span><strong>{totals.awaiting_review}</strong><small>Pending independent Review</small>
        </button>
        <button type="button" className={route.filter === "open" ? "is-selected" : ""} onClick={() => navigate(scopeRoute({ filter: "open" }))}>
          <span>CONTRIBUTE QUEUE</span><strong>{totals.open}</strong><small>Open Challenges accepting work</small>
        </button>
      </div>
      <div className="work-filters" aria-label="Filter work stream">
        {filters.map((filter) => <button key={filter.value} type="button" className={route.filter === filter.value ? "is-selected" : ""} onClick={() => navigate(scopeRoute({ filter: filter.value }))}>{filter.label}</button>)}
      </div>
      <div className="work-stream" aria-live="polite">
        {visibleWork.map((item) => {
          const stamp = item.stream_state === "resolved" ? item.challenge.updated_at : item.challenge.created_at;
          return (
            <button className={`work-row${highlights.changedChallengeIds.has(item.challenge.id) ? " is-fresh" : ""}`} type="button" key={`${item.stream_state}-${item.challenge.id}`} data-state={item.stream_state} onClick={() => navigate(scopeRoute({ challengeId: item.challenge.id }))}>
              <span className="work-state">{streamLabel(item.stream_state)}</span>
              <span className="work-copy"><strong>{item.challenge.title}</strong>{route.scope.kind === "network" ? <span className="work-quest-title">{demoPrefix(item.quest)}{item.quest.title}</span> : null}<span className="work-challenge-description">{item.challenge.description}</span>{item.contribution ? <small>{item.stream_state === "resolved" ? "RESULT: " : "CONTRIBUTION: "}{item.contribution.summary}</small> : null}</span>
              <time dateTime={stamp}>{compactTime(stamp)}</time>
            </button>
          );
        })}
        {visibleWork.length === 0 ? <p className="empty-console">No work matches this filter.</p> : null}
      </div>
    </section>
  );
}

function ActivityPanel({
  data,
  latestEventSequence,
}: {
  data: ObserveResponse;
  latestEventSequence: number | null;
}) {
  return (
    <section className="ops-panel activity-console" aria-labelledby="activity-title">
      <div className="panel-heading"><h2 id="activity-title">PUBLIC ACTIVITY</h2><span>LATEST EVENT #{data.freshness.last_sequence}</span></div>
      <div className="activity-list" data-testid="activity-list" aria-live="polite" aria-relevant="additions text">
        {data.activity.map((event) => (
          <div className={`activity-row${latestEventSequence === event.sequence ? " is-fresh" : ""}`} key={event.sequence}>
            <span className="activity-icon">#{String(event.sequence).padStart(4, "0")}</span>
            <div>
              <strong>{event.summary}</strong>
              <span className="activity-meta">
                <span>{event.actor_label ?? "OpenQuest"}</span>
                <span className="activity-kind">{event.event_type.replace(".", " / ")}</span>
              </span>
            </div>
            <time dateTime={event.created_at}>{compactTime(event.created_at)}</time>
          </div>
        ))}
        {data.activity.length === 0 ? <p className="empty-copy">No public activity yet.</p> : null}
      </div>
    </section>
  );
}

function RailSection({
  children,
  className,
  meta,
  onToggle,
  open,
  title,
}: {
  children: ReactNode;
  className: string;
  meta?: string;
  onToggle: () => void;
  open: boolean;
  title: string;
}) {
  return (
    <section className={`ops-panel rail-section${open ? " is-open" : ""} ${className}`}>
      <button type="button" className="panel-heading" aria-expanded={open} onClick={onToggle}>
        <h2>{title}</h2>
        {meta ? <span>{meta}</span> : null}
        <span className="rail-toggle" aria-hidden="true">{open ? "–" : "+"}</span>
      </button>
      {open ? <div className="rail-section-body">{children}</div> : null}
    </section>
  );
}

function ContributorPanel({
  data,
  onToggle,
  open,
}: {
  data: ObserveResponse;
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <RailSection className="contributor-panel" title="RECENT CONTRIBUTORS" meta={`${data.contributor_count} TOTAL`} open={open} onToggle={onToggle}>
      <div className="contributor-list">
        {data.recent_contributors.map((contributor) => (
          <div className="contributor-row" key={contributor.actor_label}>
            <span className="contributor-avatar">{agentInitials(contributor.actor_label)}</span>
            <span className="contributor-copy"><strong>{contributor.actor_label}</strong><span>{contributor.last_summary}</span></span>
            <span className="recent-badge">{contributor.activity_count} EVT</span>
          </div>
        ))}
        {data.recent_contributors.length === 0 ? <p className="empty-copy">No durable contributor activity yet.</p> : null}
      </div>
    </RailSection>
  );
}

function Metric({
  label,
  metric,
  detail,
  value,
  delta,
  tone,
}: {
  label: string;
  metric: string;
  detail: string;
  value: number;
  delta: number | null;
  tone: string;
}) {
  return (
    <div className="telemetry-cell" data-metric={metric} data-tone={tone}>
      <span>{label}</span>
      <small>{detail}</small>
      <strong>
        <span className="metric-value">{value}</span>
        {delta !== null ? <span className="metric-delta" data-testid={`metric-delta-${metric}`}>{formatMetricDelta(delta)}</span> : null}
      </strong>
    </div>
  );
}

function WebMcpPanel({
  onToggle,
  open,
  prompt,
  tools,
  viewer,
}: {
  onToggle: () => void;
  open: boolean;
  prompt: string;
  tools: WebMCPToolsState;
  viewer: ObserveResponse["viewer"];
}) {
  const state = webMcpSurfaceState(tools);
  const sessionLine = viewer ? `SESSION · ${viewer.actor_label}` : "SESSION · NOT ESTABLISHED";
  return (
    <RailSection className="webmcp-panel" title="WEBMCP TOOL BUS" meta={webMcpPanelLabel(state)} open={open} onToggle={onToggle}>
      <p className="session-line" data-testid="session-line" title={SESSION_HELP_TEXT}>{sessionLine}</p>
      <p className="agent-instruction">Use with an agent: “{prompt}”</p>
      <div className="tool-list">
        {webMcpTools.map(([name, mode]) => (
          <div className="tool-chip" key={name}><code>{name}</code><span>{mode}</span></div>
        ))}
      </div>
      {tools.registered ? null : (
        <details className="webmcp-diagnostics">
          <summary>WebMCP diagnostics</summary>
          <ul>
            <li>Secure context: {tools.secureContext ? "YES" : "NO"}</li>
            <li>document.modelContext: {tools.modelContextDetected ? "DETECTED" : "NOT DETECTED"}</li>
            <li>Registration: {webMcpRegistrationFact(state)}</li>
          </ul>
          {tools.modelContextDetected ? null : (
            <p>
              {WEBMCP_UNAVAILABLE_GUIDANCE}{" "}
              <a href={WEBMCP_CHROME_DOCS_URL} rel="noreferrer" target="_blank">Chrome WebMCP documentation</a>
            </p>
          )}
          {tools.error ? <p className="webmcp-error">{tools.error}</p> : null}
        </details>
      )}
    </RailSection>
  );
}

function QuestList({
  data,
  onNavigate,
  onToggle,
  open,
  route,
}: {
  data: ObserveResponse;
  onNavigate: RouteNavigationHandler;
  onToggle: () => void;
  open: boolean;
  route: RouteState;
}) {
  return (
    <RailSection className="quest-list-panel" title="QUESTS" meta={`${data.quests.length} VISIBLE`} open={open} onToggle={onToggle}>
      <div className="quest-list">
        {data.quests.map((quest, index) => {
          const total = quest.counts.open + quest.counts.awaiting_review + quest.counts.resolved;
          const completion = total === 0 ? 0 : Math.round((quest.counts.resolved / total) * 100);
          return (
            <a className="quest-row quest-queue-row" href={`/q/${quest.slug}`} key={quest.id} onClick={onNavigate({ scope: { kind: "quest", slug: quest.slug }, filter: route.filter, challengeId: null })}>
              <span className="quest-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="quest-queue-copy">
                <h3>{demoPrefix(quest)}{quest.title}</h3>
                <p>{quest.goal}</p>
                <div className="queue-meter" role="progressbar" aria-label="Quest completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}><span style={{ width: `${completion}%` }} /></div>
                <div className="queue-counts"><span>{quest.counts.open} OPEN</span><span>{quest.counts.awaiting_review} REVIEW</span><span>{quest.counts.resolved} DONE</span></div>
              </div>
            </a>
          );
        })}
        {data.quests.length === 0 ? <p className="empty-copy">No active Quests.</p> : null}
      </div>
    </RailSection>
  );
}

function QuestContext({
  data,
  onToggle,
  open,
  quest,
}: {
  data: ObserveResponse;
  onToggle: () => void;
  open: boolean;
  quest: ObserveResponse["quests"][number] | null;
}) {
  if (!quest) return null;
  const results = data.work_stream.filter((item) => item.stream_state === "resolved").slice(0, 3);
  return (
    <RailSection className="quest-context-panel" title="QUEST CONTEXT" meta={quest.is_demo ? "DEMO" : quest.organization ? "PROVENANCE" : "COMMUNITY"} open={open} onToggle={onToggle}>
      <div className="quest-context-body">
        <p>{quest.description || quest.goal}</p>
        {quest.organization ? <p className="provenance-copy">{demoPrefix(quest)}{quest.organization.name} · {quest.organization.verification_status}{quest.organization.ror_id ? ` · ${quest.organization.ror_id}` : ""}</p> : null}
        <h3>RECENT RESULTS</h3>
        {results.map((item) => <p className="result-summary" key={item.challenge.id}>{item.contribution?.summary}</p>)}
        {results.length === 0 ? <p className="empty-copy">No accepted results yet.</p> : null}
      </div>
    </RailSection>
  );
}
