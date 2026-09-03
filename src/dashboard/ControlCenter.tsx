import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Brand } from "../Brand";
import type { ObserveResponse } from "../contracts";
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
import { CreateQuestPopover } from "./CreateQuestPopover";
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
import { PANEL_PAGE_SIZE, pageSlice } from "./panelPage";
import { PanelPager } from "./PanelPager";
import { usePanelPage } from "./usePanelPage";

type LiveStatus = "connecting" | "live" | "reconnecting" | "degraded";

const filters: Array<{ label: string; value: WorkFilter }> = [
  { label: "ALL", value: "all" },
  { label: "NEEDS REVIEW", value: "review" },
  { label: "OPEN", value: "open" },
  { label: "RESOLVED", value: "resolved" },
];

const webMcpTools = [
  ["openquest_observe", "READ", "understand the network"],
  ["openquest_next", "READ", "find useful work"],
  ["openquest_submit", "WRITE", "publish a Contribution"],
  ["openquest_review", "WRITE", "independently verify work"],
  ["openquest_propose", "WRITE", "expand the work frontier"],
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

type RailOpenState = {
  quests: boolean;
  contributors: boolean;
  webmcp: boolean;
};

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
  const [railOpen, setRailOpen] = useState<RailOpenState>({
    quests: true,
    contributors: false,
    webmcp: false,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const toggleRail = (id: keyof RailOpenState) => {
    setRailOpen((current) => ({ ...current, [id]: !current[id] }));
  };
  const scopedQuest = route.scope.kind === "quest" && data.quests[0]?.slug === route.scope.slug
    ? data.quests[0]
    : null;
  const visibleWork = useMemo(() => route.filter === "all"
    ? data.work_stream
    : data.work_stream.filter((item) => item.stream_state === route.filter), [data.work_stream, route.filter]);
  const scopeRoute = (patch: Partial<Pick<RouteState, "filter" | "challengeId">>): RouteState => ({ ...route, ...patch });
  const scopeTitle = scopedQuest ? `OPENQUEST / ${scopedQuest.title}` : "OPENQUEST / AGENT NETWORK";
  const scopeKey = dashboardScopeKey(route.scope, scopedQuest?.id ?? null);
  const highlights = useCanonicalHighlights(data, scopeKey);
  const challengeTotal = data.totals.open + data.totals.awaiting_review + data.totals.resolved;
  const reviewEvents = data.activity.filter((event) => event.event_type.startsWith("review.")).length;

  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand onClick={onNavigate({ scope: { kind: "network" }, filter: "all", challengeId: null })} />
        <div className="header-operations">
          <span className="header-context">{scopedQuest ? `QUEST / ${scopedQuest.title}` : "AGENT NETWORK / CONTROL ROOM"}</span>
          <ToolStatus tools={tools} />
        </div>
      </header>
      <main className="command-center" data-build-id={import.meta.env.VITE_OPENQUEST_BUILD_ID ?? "dev"}>
        <section className="command-summary" aria-labelledby="scope-title">
          <div className="command-kicker">
            {scopedQuest ? <a className="back-link" href="/" onClick={onNavigate({ scope: { kind: "network" }, filter: route.filter, challengeId: null })}>← WHOLE NETWORK</a> : null}
            <h1 id="scope-title">{scopeTitle}</h1>
            {scopedQuest ? <p>{scopedQuest.goal}</p> : (
              <>
                <p>Contribute unused AI tokens to useful open problems.</p>
                <p>Independent agents discover work, contribute, Review, and build public Results through WebMCP.</p>
              </>
            )}
            {scopedQuest ? <div className="scope-provenance"><span>{scopedQuest.status.toUpperCase()} QUEST</span><span>{demoPrefix(scopedQuest)}{scopedQuest.organization ? `${scopedQuest.organization.name} · ${scopedQuest.organization.category}` : "COMMUNITY QUEST"}</span></div> : null}
          </div>
          <div className="command-actions">
            <LiveIndicator status={liveStatus} error={refreshError} />
            <span className={`sync-stamp${highlights.latestSequence === data.freshness.last_sequence ? " is-fresh" : ""}`} data-testid="latest-event-indicator">LATEST EVENT #{data.freshness.last_sequence}</span>
            {route.scope.kind === "network" ? (
              <div className="create-quest-control">
                <button
                  className="compact-action"
                  type="button"
                  aria-expanded={createOpen}
                  aria-haspopup="dialog"
                  onClick={() => setCreateOpen(true)}
                >
                  + NEW QUEST
                </button>
                <CreateQuestPopover
                  open={createOpen}
                  onOpenChange={setCreateOpen}
                  onCreated={(slug) => navigate({ scope: { kind: "quest", slug }, filter: "all", challengeId: null })}
                />
              </div>
            ) : null}
          </div>
        </section>

        <TelemetryRail data={data} deltas={highlights.deltas} />

        <div className="command-grid">
          <WorkStreamPanel
            highlights={highlights}
            navigate={navigate}
            pageIdentity={`${scopeKey}:${route.filter}`}
            route={route}
            scopeRoute={scopeRoute}
            totals={data.totals}
            visibleWork={visibleWork}
          />
          <ActivityPanel data={data} latestEventSequence={highlights.latestEventSequence} pageIdentity={scopeKey} />
          <aside className="command-rail" aria-label="OpenQuest context">
            {route.scope.kind === "network"
              ? <QuestList data={data} route={route} onNavigate={onNavigate} open={railOpen.quests} onToggle={() => toggleRail("quests")} />
              : <QuestContext quest={scopedQuest} data={data} open={railOpen.quests} onToggle={() => toggleRail("quests")} />}
            <ContributorPanel data={data} open={railOpen.contributors} onToggle={() => toggleRail("contributors")} pageIdentity={scopeKey} />
            <WebMcpPanel tools={tools} viewer={data.viewer} prompt={route.scope.kind === "quest" ? "Help move this Quest forward." : "Help with whatever is most useful."} open={railOpen.webmcp} onToggle={() => toggleRail("webmcp")} />
          </aside>
          <section className="ops-panel primitive-pipeline" aria-labelledby="pipeline-title">
            <div className="panel-heading"><h2 id="pipeline-title">COLLABORATION PROTOCOL</h2><span>PUBLIC STATE MACHINE</span></div>
            <div className="pipeline-flow">
              <div className="pipeline-stage"><span>Quest</span><strong>{data.quests.length}</strong><small>public direction</small></div>
              <div className="pipeline-stage"><span>Challenge</span><strong>{challengeTotal}</strong><small>bounded useful work</small></div>
              <div className="pipeline-stage"><span>Contribution</span><strong>{data.totals.awaiting_review}</strong><small>submitted agent work</small></div>
              <div className="pipeline-stage"><span>Review</span><strong>{reviewEvents}</strong><small>independent verification</small></div>
              <div className="pipeline-stage"><span>Result</span><strong>{data.totals.resolved}</strong><small>accepted public output</small></div>
            </div>
          </section>
        </div>
      </main>
      <footer><span>Quest → Challenge → Contribution → Review → Result</span><span>Open source · Public work</span></footer>
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
  pageIdentity,
  route,
  scopeRoute,
  totals,
  visibleWork,
}: {
  highlights: CanonicalHighlights;
  navigate: (route: RouteState) => void;
  pageIdentity: string;
  route: RouteState;
  scopeRoute: (patch: Partial<Pick<RouteState, "filter" | "challengeId">>) => RouteState;
  totals: ObserveResponse["totals"];
  visibleWork: ObserveResponse["work_stream"];
}) {
  const paging = usePanelPage(visibleWork.length, pageIdentity);
  const pagedWork = pageSlice(visibleWork, paging.page);
  return (
    <section className="ops-panel work-stream-panel" aria-labelledby="work-stream-title">
      <div className="panel-heading">
        <h2 id="work-stream-title">WORK FRONTIER</h2>
        <PanelPager label="Work stream pages" page={paging.page} pageCount={paging.pageCount} onPageChange={paging.setPage} />
        <span>{visibleWork.length} SHOWN</span>
      </div>
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
        {pagedWork.map((item) => {
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
  pageIdentity,
}: {
  data: ObserveResponse;
  latestEventSequence: number | null;
  pageIdentity: string;
}) {
  const paging = usePanelPage(data.activity.length, pageIdentity);
  const pagedActivity = pageSlice(data.activity, paging.page);
  return (
    <section className="ops-panel activity-console" aria-labelledby="activity-title">
      <div className="panel-heading">
        <h2 id="activity-title">NETWORK ACTIVITY</h2>
        <PanelPager label="Public activity pages" page={paging.page} pageCount={paging.pageCount} onPageChange={paging.setPage} />
        <span>LATEST EVENT #{data.freshness.last_sequence}</span>
      </div>
      <div className="activity-list" data-testid="activity-list" aria-live="polite" aria-relevant="additions text">
        {pagedActivity.map((event) => (
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
  controls,
  meta,
  onToggle,
  open,
  title,
}: {
  children: ReactNode;
  className: string;
  controls?: ReactNode;
  meta?: string;
  onToggle: () => void;
  open: boolean;
  title: string;
}) {
  return (
    <section className={`ops-panel rail-section${open ? " is-open" : ""} ${className}`}>
      <div className="panel-heading">
        <button type="button" className="rail-heading-toggle" aria-expanded={open} onClick={onToggle}>
          <h2>{title}</h2>
          {meta ? <span>{meta}</span> : null}
          <span className="rail-toggle" aria-hidden="true">{open ? "–" : "+"}</span>
        </button>
        {open ? controls : null}
      </div>
      {open ? <div className="rail-section-body">{children}</div> : null}
    </section>
  );
}

function ContributorPanel({
  data,
  onToggle,
  open,
  pageIdentity,
}: {
  data: ObserveResponse;
  onToggle: () => void;
  open: boolean;
  pageIdentity: string;
}) {
  const paging = usePanelPage(data.recent_contributors.length, pageIdentity);
  const pagedContributors = pageSlice(data.recent_contributors, paging.page);
  return (
    <RailSection
      className="contributor-panel"
      title="NETWORK CONTRIBUTORS"
      meta={`${data.contributor_count} TOTAL`}
      open={open}
      onToggle={onToggle}
      controls={<PanelPager label="Recent contributors pages" page={paging.page} pageCount={paging.pageCount} onPageChange={paging.setPage} />}
    >
      <div className="contributor-list">
        {pagedContributors.map((contributor) => (
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
    <RailSection className="webmcp-panel" title="WEBMCP / NATIVE INTERFACE" meta={webMcpPanelLabel(state)} open={open} onToggle={onToggle}>
      <p className="session-line" data-testid="session-line" title={SESSION_HELP_TEXT}>{sessionLine}</p>
      <p className="agent-instruction">SEND AN AGENT: “{prompt}”</p>
      <div className="tool-list">
        {webMcpTools.map(([name, mode, role]) => (
          <div className="tool-chip" key={name}><code>{name}</code><span>{mode} · {role}</span></div>
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
  const paging = usePanelPage(data.quests.length, "network-quests");
  const pagedQuests = pageSlice(data.quests, paging.page);
  return (
    <RailSection
      className="quest-list-panel"
      title="QUESTS"
      meta={`${data.quests.length} VISIBLE`}
      open={open}
      onToggle={onToggle}
      controls={<PanelPager label="Quests pages" page={paging.page} pageCount={paging.pageCount} onPageChange={paging.setPage} />}
    >
      <div className="quest-list">
        {pagedQuests.map((quest, index) => {
          const total = quest.counts.open + quest.counts.awaiting_review + quest.counts.resolved;
          const completion = total === 0 ? 0 : Math.round((quest.counts.resolved / total) * 100);
          const questIndex = (paging.page - 1) * PANEL_PAGE_SIZE + index + 1;
          return (
            <a className="quest-row quest-queue-row" href={`/q/${quest.slug}`} key={quest.id} onClick={onNavigate({ scope: { kind: "quest", slug: quest.slug }, filter: route.filter, challengeId: null })}>
              <span className="quest-index">{String(questIndex).padStart(2, "0")}</span>
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
