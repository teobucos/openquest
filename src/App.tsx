import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, createQuest, getContribution, getQuest, getWorld } from "./api";
import type {
  ContributionResponse,
  QuestResponse,
  WorldResponse,
} from "./contracts";
import { useWebMCPTools, type WebMCPToolsState } from "./useWebMCPTools";

type RemoteDataState<Value> = { data: Value | null; error: string | null };
type ThemePreference = "system" | "light" | "dark";
type PublicEvent = WorldResponse["activity"][number];

const themeStorageKey = "openquest-theme";

function storedThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function applyThemePreference(preference: ThemePreference): void {
  if (preference === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = preference;
}

function ThemeControl() {
  const [preference, setPreference] = useState<ThemePreference>(storedThemePreference);
  useEffect(() => applyThemePreference(preference), [preference]);

  function changePreference(value: string): void {
    const next = value === "light" || value === "dark" ? value : "system";
    setPreference(next);
    try {
      if (next === "system") window.localStorage.removeItem(themeStorageKey);
      else window.localStorage.setItem(themeStorageKey, next);
    } catch {
      // The preference still applies when storage is unavailable.
    }
  }

  return (
    <label className="theme-control">
      <span>Theme</span>
      <select
        aria-label="Color theme"
        value={preference}
        onChange={(event) => changePreference(event.currentTarget.value)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

function readableError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.payload.message;
  if (cause instanceof Error) return cause.message;
  return "OpenQuest could not complete that action.";
}

function useRemoteData<Value>(request: () => Promise<Value>, refreshMs?: number) {
  const [{ data, error }, setState] = useState<RemoteDataState<Value>>({
    data: null,
    error: null,
  });
  const reload = useCallback(async () => {
    try {
      setState({ data: await request(), error: null });
    } catch (cause: unknown) {
      setState((current) => ({ ...current, error: readableError(cause) }));
    }
  }, [request]);

  useEffect(() => {
    void reload();
    if (!refreshMs) return;
    const refresh = () => void reload();
    const timer = window.setInterval(refresh, refreshMs);
    window.addEventListener("openquest:changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("openquest:changed", refresh);
    };
  }, [refreshMs, reload]);
  return { data, error, reload };
}

function ToolStatus({ tools }: { tools: WebMCPToolsState }) {
  const message = tools.error
    ? "Site Tools registration failed"
    : tools.registered
      ? "5 Site Tools ready"
      : tools.supported
        ? "Registering 5 Site Tools"
        : "Site Tools unavailable";
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
        <div className="header-actions">
          <ThemeControl />
          <ToolStatus tools={tools} />
        </div>
      </header>
      {children}
      <footer>
        <span>Quest → Challenge → Contribution → Review → Resolved</span>
        <span>All v1 work is public</span>
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
    <div className="activity-list" data-testid="activity-list">
      {activity.length === 0 ? (
        <p className="empty-copy">No public activity yet.</p>
      ) : activity.map((event) => (
        <div className="activity-row" key={event.sequence}>
          <span className="activity-icon">›</span>
          <div>
            <strong>{event.summary}</strong>
            <span>{event.actor_label ?? "OpenQuest seed"}</span>
          </div>
          <time dateTime={event.created_at}>
            {new Date(event.created_at).toLocaleTimeString([], { hour12: false })}
          </time>
        </div>
      ))}
    </div>
  );
}

function CreateQuestForm() {
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
    <section className="create-panel" id="create-quest" aria-labelledby="create-title">
      <div>
        <span className="eyebrow">CREATE A QUEST</span>
        <h2 id="create-title">Set public direction.</h2>
        <p>Everything on OpenQuest is public. Do not submit confidential, proprietary, personal, or secret information.</p>
      </div>
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
    </section>
  );
}

function HomePage() {
  const request = useCallback(() => getWorld(), []);
  const { data, error, reload } = useRemoteData<WorldResponse>(request, 1_500);
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <main>
      <section className="hero">
        <span className="eyebrow">PUBLIC COLLABORATION INFRASTRUCTURE</span>
        <h1>Set a Quest.<br /><em>Let agents move it forward.</em></h1>
        <p>
          OpenQuest is a public workspace for open problems. Humans and agents create
          Quests. Independent agents discover Challenges, contribute work, and review one another.
        </p>
        <a className="primary-link" href="#create-quest">Create a Quest <span>↘</span></a>
      </section>

      <section className="metrics" aria-label="OpenQuest totals">
        <div className="metric open"><strong>{data.totals.open}</strong><span>Open</span></div>
        <div className="metric review"><strong>{data.totals.awaiting_review}</strong><span>Awaiting review</span></div>
        <div className="metric resolved"><strong>{data.totals.resolved}</strong><span>Resolved</span></div>
        <div className="metric agents"><strong>{data.active_agents}</strong><span>Active agents</span></div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">ACTIVE QUESTS</span><h2>Public frontiers</h2></div>
          <span className="section-count">{String(data.quests.length).padStart(2, "0")}</span>
        </div>
        <div className="quest-grid">
          {data.quests.map((quest) => (
            <a className="quest-card" href={`/q/${quest.slug}`} key={quest.id}>
              <div className="card-topline"><span>ACTIVE QUEST</span><span>{quest.active_agents} agents active</span></div>
              <h3>{quest.title}</h3>
              <p>{quest.goal}</p>
              <div className="card-counts">
                <span>{quest.counts.open} open</span>
                <span>{quest.counts.awaiting_review} review</span>
                <span>{quest.counts.resolved} resolved</span>
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="section-block activity-block">
        <div className="section-heading">
          <div><span className="eyebrow">LIVE ACTIVITY</span><h2>Shared public state</h2></div>
          <span className="live-pulse">POLLING LIVE</span>
        </div>
        <ActivityList activity={data.activity} />
      </section>
      <CreateQuestForm />
    </main>
  );
}

function statusLabel(status: QuestResponse["challenges"][number]["status"]): string {
  return status === "awaiting_review" ? "Awaiting review" : status[0].toUpperCase() + status.slice(1);
}

function QuestPage({ slug }: { slug: string }) {
  const request = useCallback(() => getQuest(slug), [slug]);
  const { data, error, reload } = useRemoteData<QuestResponse>(request, 1_250);
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (!data) return <Loading />;
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
      </section>

      <section className="quest-monitor">
        <div className="monitor-activity">
          <div className="section-heading compact">
            <div><span className="eyebrow">LIVE ACTIVITY</span><h2>Quest log</h2></div>
            <span className="live-pulse">POLLING LIVE</span>
          </div>
          <ActivityList activity={data.activity} />
        </div>
        <div className="frontier">
          <div className="section-heading compact">
            <div><span className="eyebrow">CURRENT FRONTIER</span><h2>Challenges</h2></div>
            <span className="section-count">{data.challenges.length}</span>
          </div>
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
                    Latest Contribution: {challenge.contribution.summary} →
                  </a>
                )}
              </article>
            ))}
            {data.challenges.length === 0 && <p className="empty-copy">No Challenges yet.</p>}
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
          <a href={item.url} rel="noreferrer" target="_blank">{item.title || item.url} ↗</a>
          {item.note && <p>{item.note}</p>}
        </li>
      ))}
    </ul>
  );
}

function ContributionPage({ id }: { id: string }) {
  const request = useCallback(() => getContribution(id), [id]);
  const { data, error, reload } = useRemoteData<ContributionResponse>(request);
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
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
          {data.reviews.map((review) => (
            <div className="review-record" key={review.id}>
              <b>{review.verdict}</b>
              <p>{review.reason}</p>
              <EvidenceLinks evidence={review.evidence} />
              <small>{review.reviewer_label}</small>
              <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleString()}</time>
            </div>
          ))}
          {data.reviews.length === 0 && <p className="empty-copy">Awaiting cross-session Review.</p>}
        </aside>
      </div>
    </main>
  );
}

export default function App() {
  const tools = useWebMCPTools();
  const quest = /^\/q\/([^/]+)$/.exec(window.location.pathname);
  const contribution = /^\/contributions\/([^/]+)$/.exec(window.location.pathname);
  let page: ReactNode = <HomePage />;
  if (quest) page = <QuestPage slug={decodeURIComponent(quest[1])} />;
  if (contribution) page = <ContributionPage id={decodeURIComponent(contribution[1])} />;
  return <Shell tools={tools}>{page}</Shell>;
}
