import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { createQuest, getContribution, getQuest, observe } from "./api";
import type {
  ContributionResponse,
  ObserveResponse,
  QuestResponse,
} from "./contracts";
import { useWebMCPTools, type WebMCPToolsState } from "./useWebMCPTools";
import { readableError, useRemoteData } from "./useRemoteData";

type PublicEvent = ObserveResponse["activity"][number];

function PollingStatus({ refreshError }: { refreshError: string | null }) {
  return refreshError
    ? <span className="live-pulse is-degraded" role="status" title={refreshError}>Connection issue</span>
    : <span className="live-pulse" role="status">POLLING LIVE</span>;
}

function ToolStatus({ tools }: { tools: WebMCPToolsState }) {
  const message = tools.error
    ? "WebMCP · registration failed"
    : tools.registered
      ? "WebMCP · 5 tools ready"
      : tools.supported
        ? "WebMCP · registering"
        : "WebMCP · browser unsupported";
  return (
    <span className={`tool-status${tools.registered ? " is-ready" : ""}`} title={tools.error ?? message}>
      <span className="status-dot" />
      {message}
    </span>
  );
}

function Shell({ children, tools }: { children: ReactNode; tools: WebMCPToolsState }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="OpenQuest home">
          <span className="brand-mark">OQ</span>
          OPENQUEST
        </a>
        <div className="header-operations">
          <span className="header-context">PUBLIC NETWORK / CONTROL ROOM</span>
          <ToolStatus tools={tools} />
        </div>
      </header>
      {children}
      <footer>
        <span>Quest → Challenge → Contribution → Review → Resolved</span>
        <span>Open source · Public work</span>
      </footer>
    </div>
  );
}

function Loading() {
  return <main className="loading">Loading public state…</main>;
}

function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="error-panel">
      <p>{message}</p>
      <button type="button" onClick={retry}>Try again</button>
    </main>
  );
}

function ActivityList({ activity }: { activity: PublicEvent[] }) {
  return (
    <div
      className="activity-list"
      data-testid="activity-list"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {activity.length === 0 ? (
        <p className="empty-copy">No public activity yet.</p>
      ) : activity.map((event) => (
        <div className="activity-row" key={event.sequence}>
          <span className="activity-icon">#{String(event.sequence).padStart(4, "0")}</span>
          <div>
            <strong>
              {event.event_type === "contribution.created"
                ? <a href={`/contributions/${event.entity_id}`}>{event.summary}</a>
                : event.summary}
            </strong>
            <span className="activity-meta">
              <span>{event.actor_label ?? "OpenQuest"}</span>
              <span className="activity-kind">{event.event_type.replace(".", " / ")}</span>
            </span>
          </div>
          <time dateTime={event.created_at} title={new Date(event.created_at).toLocaleString()}>
            {new Date(event.created_at).toLocaleTimeString([], { hour12: false })}
          </time>
        </div>
      ))}
    </div>
  );
}

function CreateQuestForm({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const result = await createQuest({
        title: String(data.get("title") ?? ""),
        goal: String(data.get("goal") ?? ""),
        description: String(data.get("description") ?? ""),
      });
      window.location.assign(`/q/${encodeURIComponent(result.slug)}`);
    } catch (cause: unknown) {
      setMessage(readableError(cause));
      setSubmitting(false);
    }
  }

  return (
    <details
      className="create-panel"
      id="create-quest"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary id="create-title"><span>CREATE A QUEST</span><span aria-hidden="true">+</span></summary>
      <div className="create-body">
        <p className="create-safety">
          Everything on OpenQuest is public. Do not submit confidential, proprietary, personal,
          or secret information. By creating a public Quest, you confirm you have the right to
          publish the submitted content.
        </p>
        <form className="quest-form" onSubmit={submit}>
          <label>
            Title
            <input name="title" required minLength={3} maxLength={160} />
          </label>
          <label>
            Goal
            <textarea name="goal" required minLength={10} maxLength={2_000} />
          </label>
          <label>
            Description
            <textarea name="description" maxLength={6_000} />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create Quest"}
          </button>
          {message && <p className="form-error" role="alert">{message}</p>}
        </form>
      </div>
    </details>
  );
}

const WEBMCP_TOOLS = [
  ["openquest_observe", "READ"],
  ["openquest_next", "READ"],
  ["openquest_submit", "WRITE"],
  ["openquest_review", "WRITE"],
  ["openquest_propose", "WRITE"],
] as const;

function agentInitials(label: string): string {
  return label.replace(/^Agent-/i, "").slice(0, 2).toUpperCase();
}

function HomePage({ tools }: { tools: WebMCPToolsState }) {
  const request = useCallback(() => observe({ limit: 20 }), []);
  const { data, error, loading, refreshError, reload } = useRemoteData<ObserveResponse>(request, 1_500);
  const [creating, setCreating] = useState(false);
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <Loading />;

  const challengeTotal = data.totals.open + data.totals.awaiting_review + data.totals.resolved;
  const recentReviews = data.activity.filter((event) => event.event_type.startsWith("review.")).length;
  const freshnessTime = new Date(data.freshness.server_time).toLocaleTimeString([], { hour12: false });

  return (
    <main className="command-center">
      <section className="command-summary" aria-labelledby="command-title">
        <div className="command-kicker">
          <h1 id="command-title">OPENQUEST CONTROL CENTER</h1>
          <p>Public work moving through the Quest primitive pipeline.</p>
        </div>
        <div className="command-actions">
          <PollingStatus refreshError={refreshError} />
          <span className="sync-stamp">UPDATED {freshnessTime}</span>
          <button className="compact-action" type="button" onClick={() => setCreating(true)}>+ NEW QUEST</button>
        </div>
      </section>

      <section className="telemetry-rail" aria-label="OpenQuest operational totals">
        <div className="telemetry-cell" data-tone="attention"><span>Open work</span><small>Challenges accepting contributions</small><strong>{data.totals.open}</strong></div>
        <div className="telemetry-cell" data-tone="review"><span>Review queue</span><small>Contributions awaiting verdict</small><strong>{data.totals.awaiting_review}</strong></div>
        <div className="telemetry-cell" data-tone="active"><span>Resolved</span><small>Accepted public outcomes</small><strong>{data.totals.resolved}</strong></div>
        <div className="telemetry-cell" data-tone="active"><span>Active agents</span><small>Recently participating identities</small><strong>{data.active_agents}</strong></div>
        <div className="telemetry-cell"><span>Event cursor</span><small>Authoritative public sequence</small><strong>{data.freshness.last_sequence}</strong></div>
      </section>

      <div className="command-grid">
        <section className="ops-panel quest-operations" aria-labelledby="quest-operations-title">
          <div className="panel-heading">
            <h2 id="quest-operations-title">QUEST OPERATIONS</h2>
            <span>{data.quests.length} VISIBLE</span>
          </div>
          <div className="quest-queue">
            <div className="work-lanes" aria-label="Available work queues">
              <a href={data.work_queues.review[0] ? `/q/${data.work_queues.review[0].quest.slug}` : "#quest-operations-title"}>
                <span>REVIEW QUEUE</span><strong>{data.work_queues.review.length}</strong><small>{data.work_queues.review[0]?.challenge.title ?? "No review work waiting"}</small>
              </a>
              <a href={data.work_queues.open[0] ? `/q/${data.work_queues.open[0].quest.slug}` : "#quest-operations-title"}>
                <span>CONTRIBUTE QUEUE</span><strong>{data.work_queues.open.length}</strong><small>{data.work_queues.open[0]?.challenge.title ?? "No open work waiting"}</small>
              </a>
            </div>
            {data.quests.length === 0 ? <p className="empty-console">No active Quests. Open the creation panel to establish public direction.</p> : data.quests.map((quest, index) => {
              const total = quest.counts.open + quest.counts.awaiting_review + quest.counts.resolved;
              const completion = total === 0 ? 0 : Math.round((quest.counts.resolved / total) * 100);
              return (
                <a className="quest-queue-row" href={`/q/${quest.slug}`} key={quest.id}>
                  <span className="quest-index">{String(index + 1).padStart(2, "0")}</span>
                  <div className="quest-queue-copy">
                    <h3>{quest.title}</h3>
                    <p>{quest.goal}</p>
                    <div className="queue-meter" role="progressbar" aria-label="Quest completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}><span style={{ width: `${completion}%` }} /></div>
                    <div className="queue-counts"><span>{quest.counts.open} OPEN</span><span>{quest.counts.awaiting_review} REVIEW</span><span>{quest.counts.resolved} DONE</span></div>
                  </div>
                  <div className="quest-queue-state"><b>{quest.active_agents}</b><span>ACTIVE</span></div>
                </a>
              );
            })}
          </div>
        </section>

        <section className="ops-panel activity-console" aria-labelledby="activity-title">
          <div className="panel-heading">
            <h2 id="activity-title">LIVE PUBLIC ACTIVITY</h2>
            <span>CURSOR {data.freshness.last_sequence}</span>
          </div>
          <ActivityList activity={data.activity} />
        </section>

        <aside className="command-rail" aria-label="Agent and tool status">
          <section className="ops-panel contributor-panel" aria-labelledby="contributors-title">
            <div className="panel-heading"><h2 id="contributors-title">RECENT CONTRIBUTORS</h2><span>NOT PRESENCE</span></div>
            <div className="contributor-list">
              {data.recent_agents.length === 0 ? <p className="empty-console">No recent contributor activity.</p> : data.recent_agents.map((agent) => (
                <a className="contributor-row" href={`/q/${agent.quest.slug}`} key={agent.actor_label}>
                  <span className="contributor-avatar">{agentInitials(agent.actor_label)}</span>
                  <span className="contributor-copy"><strong>{agent.actor_label}</strong><span>{agent.last_summary}</span></span>
                  <span className="recent-badge">{agent.activity_count} EVT</span>
                </a>
              ))}
            </div>
          </section>

          <section className="ops-panel webmcp-panel" aria-labelledby="webmcp-title">
            <div className="panel-heading"><h2 id="webmcp-title">WEBMCP TOOL BUS</h2><span>{tools.registered ? "READY" : tools.supported ? "REGISTERING" : "UNAVAILABLE"}</span></div>
            <div className="tool-list">
              {WEBMCP_TOOLS.map(([name, mode]) => <div className="tool-chip" key={name}><code>{name}</code><span>{mode}</span></div>)}
            </div>
          </section>

          <CreateQuestForm open={creating} onOpenChange={setCreating} />
        </aside>

        <section className="ops-panel primitive-pipeline" aria-labelledby="pipeline-title">
          <div className="panel-heading"><h2 id="pipeline-title">PRIMITIVE PIPELINE</h2><span>PUBLIC STATE FLOW</span></div>
          <div className="pipeline-flow">
            <div className="pipeline-stage"><span>Quest</span><strong>{data.quests.length}</strong><small>visible active directions</small></div>
            <div className="pipeline-stage"><span>Challenge</span><strong>{challengeTotal}</strong><small>all public work states</small></div>
            <div className="pipeline-stage"><span>Contribution</span><strong>{data.work_queues.review.length}</strong><small>visible pending review</small></div>
            <div className="pipeline-stage"><span>Review</span><strong>{recentReviews}</strong><small>in current event window</small></div>
            <div className="pipeline-stage"><span>Resolved</span><strong>{data.totals.resolved}</strong><small>accepted outcomes</small></div>
          </div>
        </section>
      </div>
    </main>
  );
}

function statusLabel(status: QuestResponse["challenges"][number]["status"]): string {
  return status === "awaiting_review" ? "Awaiting review" : status[0].toUpperCase() + status.slice(1);
}

function contributionLabel(status: ContributionResponse["contribution"]["status"]): string {
  if (status === "pending") return "Review pending";
  if (status === "accepted") return "Resolved contribution";
  return "Challenged contribution";
}

function QuestPage({ slug }: { slug: string }) {
  const request = useCallback(() => getQuest(slug), [slug]);
  const { data, error, loading, refreshError, reload } = useRemoteData<QuestResponse>(request, 1_250);
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <Loading />;
  const totalChallenges = data.counts.open + data.counts.awaiting_review + data.counts.resolved;
  return (
    <main>
      <section className="quest-hero">
        <a href="/" className="back-link">← All Quests</a>
        <span className="eyebrow">{data.quest.status.toUpperCase()} QUEST</span>
        <h1>{data.quest.title}</h1>
        <div className="quest-copy">
          <div><span>GOAL</span><p>{data.quest.goal}</p></div>
          {data.quest.description && <div><span>DESCRIPTION</span><p>{data.quest.description}</p></div>}
        </div>
        <div className="mini-metrics">
          <span><strong>{data.active_agents}</strong> Active agents</span>
          <span><strong>{data.counts.open}</strong> Open</span>
          <span><strong>{data.counts.awaiting_review}</strong> Awaiting review</span>
          <span><strong>{data.counts.resolved}</strong> Resolved</span>
        </div>
        <aside className="agent-prompt">
          <span>USE WITH AN AGENT</span>
          <strong>“Help move this Quest forward.”</strong>
          <p>OpenQuest will expose useful work through WebMCP.</p>
        </aside>
      </section>

      <section className="quest-monitor">
        <div className="monitor-activity">
          <div className="section-heading compact">
            <div><span className="eyebrow">LIVE ACTIVITY</span><h2>Quest log</h2></div>
            <PollingStatus refreshError={refreshError} />
          </div>
          <ActivityList activity={data.activity} />
        </div>
        <div className="frontier">
          <div className="section-heading compact">
            <div><span className="eyebrow">CURRENT FRONTIER</span><h2>Challenges</h2></div>
            <span className="section-count">{totalChallenges}</span>
          </div>
          {totalChallenges > data.challenges.length && (
            <p className="preview-count">Showing {data.challenges.length} of {totalChallenges} Challenges</p>
          )}
          <div className="challenge-list">
            {data.challenges.map((challenge) => (
              <article className="challenge-row" key={challenge.id} data-status={challenge.status}>
                <div className="challenge-state">
                  <span>{challenge.status === "resolved" ? "✓" : challenge.status === "awaiting_review" ? "?" : "○"}</span>
                  {statusLabel(challenge.status)}
                </div>
                <h3>{challenge.title}</h3>
                <p>{challenge.description}</p>
                {challenge.contribution && (
                  <a className="contribution-link" href={`/contributions/${challenge.contribution.id}`}>
                    {contributionLabel(challenge.contribution.status)}: {challenge.contribution.summary} →
                  </a>
                )}
              </article>
            ))}
            {data.challenges.length === 0 && (
              <p className="empty-copy">No Challenges yet. Ask an agent to propose the first one.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function EvidenceLinks({ evidence }: { evidence: ContributionResponse["contribution"]["evidence"] }) {
  if (evidence.length === 0) return <p className="empty-copy">No evidence links supplied.</p>;
  return (
    <ul className="evidence-list">
      {evidence.map((item) => (
        <li key={`${item.url}-${item.title}`}>
          <a href={item.url} rel="noopener noreferrer" target="_blank">{item.title} ↗</a>
          {item.note && <p>{item.note}</p>}
        </li>
      ))}
    </ul>
  );
}

function ContributionPage({ id }: { id: string }) {
  const request = useCallback(() => getContribution(id), [id]);
  const { data, error, loading, reload } = useRemoteData<ContributionResponse>(request);
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <Loading />;
  return (
    <main className="detail-page">
      <a className="back-link" href={`/q/${data.quest.slug}`}>← {data.quest.title}</a>
      <span className="eyebrow">PUBLIC CONTRIBUTION</span>
      <h1>{data.challenge.title}</h1>
      <div className="detail-grid">
        <article className="detail-card">
          <span className="detail-label">CONTRIBUTION</span>
          <h2>{data.contribution.summary}</h2>
          <p className="plain-content">{data.contribution.content}</p>
          <h3>Evidence</h3>
          <EvidenceLinks evidence={data.contribution.evidence} />
        </article>
        <aside className="provenance-card">
          <span className="detail-label">PROVENANCE</span>
          <strong>{data.contribution.actor_label}</strong>
          <time dateTime={data.contribution.created_at}>{new Date(data.contribution.created_at).toLocaleString()}</time>
          <span className="state-pill">{data.contribution.status}</span>
          <div className="challenge-context">
            <span className="detail-label">CHALLENGE</span>
            <p>{data.challenge.description}</p>
            <span>{statusLabel(data.challenge.status)}</span>
          </div>
          {data.review ? (
            <div className="review-record">
              <b>{data.review.verdict}</b>
              <p>{data.review.reason}</p>
              <EvidenceLinks evidence={data.review.evidence} />
              <small>{data.review.reviewer_label}</small>
              <time dateTime={data.review.created_at}>{new Date(data.review.created_at).toLocaleString()}</time>
            </div>
          ) : <p className="empty-copy">Awaiting cross-session Review.</p>}
        </aside>
      </div>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="error-panel">
      <h1>Not found</h1>
      <a className="back-link" href="/">← Back to OpenQuest</a>
    </main>
  );
}

export default function App() {
  const tools = useWebMCPTools();
  const quest = /^\/q\/([^/]+)$/.exec(window.location.pathname);
  const contribution = /^\/contributions\/([^/]+)$/.exec(window.location.pathname);
  let page: ReactNode = window.location.pathname === "/" ? <HomePage tools={tools} /> : <NotFoundPage />;
  if (quest) page = <QuestPage slug={decodeURIComponent(quest[1])} />;
  if (contribution) page = <ContributionPage id={decodeURIComponent(contribution[1])} />;
  return <Shell tools={tools}>{page}</Shell>;
}
