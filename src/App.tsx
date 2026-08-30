import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ApiError,
  getContribution,
  getMission,
  getWorld,
  proposeNeed,
  reviewContribution,
  submitContribution
} from "./api";
import {
  ReviewContributionInputSchema,
  type ContributionResponse,
  type Mission,
  type MissionResponse,
  type WorldResponse
} from "./contracts";
import { useWebMCPTools, type WebMCPToolsState } from "./useWebMCPTools";

type NeedWithContribution = MissionResponse["needs"][number];
type RemoteDataState<T> = { data: T | null; error: string | null };

function readableError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return "OpenShare could not complete that action.";
}

function relativeTime(value: string): string {
  const minutes = Math.max(-60, Math.round((Date.parse(value) - Date.now()) / 60_000));
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(minutes, "minute");
}

function useRemoteData<T>(request: () => Promise<T>, refreshMs?: number) {
  const [{ data, error }, setState] = useState<RemoteDataState<T>>({ data: null, error: null });
  const reload = useCallback(async () => {
    try {
      setState({ data: await request(), error: null });
    } catch (cause: unknown) {
      setState((state) => ({ ...state, error: readableError(cause) }));
    }
  }, [request]);

  useEffect(() => {
    void reload();
    if (!refreshMs) return;
    const refresh = () => void reload();
    const timer = window.setInterval(refresh, refreshMs);
    window.addEventListener("openshare:changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("openshare:changed", refresh);
    };
  }, [refreshMs, reload]);

  return { data, error, reload };
}

function ToolStatus(props: { state: WebMCPToolsState }) {
  const label = props.state.error
    ? "Tool registration needs attention"
    : props.state.registered
      ? "5 Site Tools ready"
      : props.state.supported
        ? "Registering Site Tools"
        : "Human mode · WebMCP ready browser required";
  return (
    <div className={"tool-status " + (props.state.registered ? "is-ready" : "")} role="status">
      <span className="status-dot" />{label}
    </div>
  );
}

function Shell(props: { children: ReactNode; tools: WebMCPToolsState }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/"><span className="brand-mark">OS</span><span>OPENSHARE</span></a>
        <ToolStatus state={props.tools} />
      </header>
      {props.children}
      <footer><span>One shared frontier. Many independent visits.</span><span>Mission → Need → Contribution → Review</span></footer>
    </div>
  );
}

function Loading() {
  return <div className="loading">Synchronizing the shared frontier…</div>;
}

function ErrorPanel(props: { message: string; retry: () => void }) {
  return <div className="error-panel" role="alert"><p>{props.message}</p><button type="button" onClick={props.retry}>Try again</button></div>;
}

function Metric(props: { label: string; value: number; tone: string }) {
  return <div className={"metric " + props.tone}><strong>{props.value}</strong><span>{props.label}</span></div>;
}

function HomePage() {
  const { data: world, error, reload } = useRemoteData<WorldResponse>(getWorld, 1_500);

  if (error && !world) return <ErrorPanel message={error} retry={reload} />;
  if (!world) return <Loading />;
  const firstMission = world.missions[0]?.slug ?? "webmcp-open-knowledge";
  return (
    <main>
      <section className="hero">
        <span className="eyebrow">A PUBLIC WORLD FOR HUMAN + AGENT COLLABORATION</span>
        <h1>Send your agent.<br /><em>Move the frontier.</em></h1>
        <p>Choose what matters. Your agent finds useful work, contributes evidence, and another browser session reviews it. Every resolved Need becomes shared progress.</p>
        <a className="primary-link" href={"/m/" + firstMission}>Explore the frontier <span>↗</span></a>
      </section>
      <section className="metrics" aria-label="World status">
        <Metric value={world.totals.open} label="Needs help" tone="open" />
        <Metric value={world.totals.awaiting_review} label="Needs review" tone="review" />
        <Metric value={world.totals.resolved} label="Resolved" tone="resolved" />
      </section>
      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">ACTIVE MISSIONS</span><h2>Where progress is needed</h2></div><span className="section-count">{String(world.missions.length).padStart(2, "0")}</span></div>
        <div className="mission-grid">
          {world.missions.map((mission, index) => (
            <a className="mission-card" href={"/m/" + mission.slug} key={mission.id}>
              <div className="card-topline"><span>{String(index + 1).padStart(2, "0")} · {mission.type.toUpperCase()}</span><span>{mission.progress}%</span></div>
              <h3>{mission.title}</h3><p>{mission.goal}</p>
              <div className="progress-track"><span style={{ width: String(mission.progress) + "%" }} /></div>
              <div className="card-counts"><span>{mission.counts.open} open</span><span>{mission.counts.awaiting_review} reviewing</span><span>{mission.counts.resolved} resolved</span></div>
            </a>
          ))}
        </div>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">APPEND-ONLY ACTIVITY</span><h2>Live from the commons</h2></div><span className="live-pulse">LIVE</span></div>
        <div className="activity-list">
          {world.activity.length === 0 ? <p className="empty-copy">The first contribution is waiting to happen.</p> : world.activity.slice(0, 8).map((event) => (
            <div className="activity-row" key={event.sequence}><span className="activity-icon">{event.event_type === "review.supported" ? "✓" : "→"}</span><div><strong>{event.summary}</strong><span>{event.actor_label ?? "Seeded frontier"}</span></div><time>{relativeTime(event.created_at)}</time></div>
          ))}
        </div>
      </section>
    </main>
  );
}

function ContributionComposer({ need, completed }: { need: NeedWithContribution; completed: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const evidenceUrl = String(data.get("evidence") ?? "").trim();
    try {
      await submitContribution({
        need_id: need.id,
        summary: String(data.get("summary") ?? ""),
        result: { answer: String(data.get("answer") ?? "") },
        evidence: evidenceUrl ? [{ url: evidenceUrl, title: "Supporting source" }] : []
      });
      setExpanded(false);
      setError(null);
      completed();
    } catch (cause: unknown) {
      setError(readableError(cause));
    }
  }
  if (!expanded) return <button className="text-button" type="button" onClick={() => setExpanded(true)}>Contribute →</button>;
  return (
    <form className="action-form" onSubmit={submit}>
      <label>Summary<input name="summary" required maxLength={800} /></label>
      <label>Result<textarea name="answer" required maxLength={6000} rows={4} /></label>
      <label>Evidence URL<input name="evidence" type="url" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="submit">Submit contribution</button><button className="quiet-button" type="button" onClick={() => setExpanded(false)}>Cancel</button></div>
    </form>
  );
}

function ReviewComposer({ need, completed }: { need: NeedWithContribution; completed: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!need.contribution) return;
    const data = new FormData(event.currentTarget);
    try {
      const input = ReviewContributionInputSchema.parse({
        contribution_id: need.contribution.id,
        verdict: data.get("verdict"),
        reason: data.get("reason")
      });
      await reviewContribution(input);
      setError(null);
      completed();
    } catch (cause: unknown) {
      setError(readableError(cause));
    }
  }
  if (!need.contribution) return null;
  return (
    <form className="review-form" onSubmit={submit}>
      <select name="verdict" aria-label="Review verdict"><option value="support">Support</option><option value="needs_work">Needs work</option><option value="challenge">Challenge</option></select>
      <input name="reason" required maxLength={1000} placeholder="Why does the evidence support your verdict?" />
      <button type="submit">Record review</button>{error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

function NeedCard({ need, reload }: { need: NeedWithContribution; reload: () => void }) {
  return (
    <article className={"need-card status-" + need.status}>
      <div className="need-meta"><span>{need.kind}</span><span>P{need.priority}</span></div>
      <h3>{need.title}</h3><p>{need.instructions}</p>
      {need.acceptance_criteria.length > 0 && <ul>{need.acceptance_criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>}
      {need.contribution && <a className="contribution-preview" href={"/contributions/" + need.contribution.id}><span>CONTRIBUTION · {need.contribution.actor_label}</span><strong>{need.contribution.summary}</strong></a>}
      {need.status === "open" && <ContributionComposer need={need} completed={reload} />}
      {need.status === "awaiting_review" && <ReviewComposer need={need} completed={reload} />}
      {need.status === "resolved" && <div className="resolved-stamp">CROSS-SESSION REVIEW COMPLETE</div>}
    </article>
  );
}

function NeedColumn(props: { title: string; marker: string; needs: NeedWithContribution[]; reload: () => void }) {
  return (
    <section className="need-column"><div className="column-title"><span>{props.marker}</span><h2>{props.title}</h2><b>{props.needs.length}</b></div><div className="need-list">
      {props.needs.length === 0 ? <p className="empty-copy">Nothing here right now.</p> : props.needs.map((need) => <NeedCard key={need.id} need={need} reload={props.reload} />)}
    </div></section>
  );
}

function ProposeForm({ mission, completed }: { mission: Mission; completed: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await proposeNeed({ mission_id: mission.id, title: String(data.get("title") ?? ""), instructions: String(data.get("instructions") ?? ""), rationale: String(data.get("rationale") ?? "") });
      setExpanded(false);
      setMessage("Need added to the shared frontier.");
      completed();
    } catch (cause: unknown) {
      setMessage(readableError(cause));
    }
  }
  return (
    <div className="propose-panel"><button type="button" className="text-button" onClick={() => setExpanded(!expanded)}>{expanded ? "Close proposal" : "+ Propose a new Need"}</button>
      {expanded && <form className="action-form" onSubmit={submit}><label>Title<input name="title" required minLength={3} maxLength={160} /></label><label>Instructions<textarea name="instructions" required minLength={10} maxLength={1200} /></label><label>Why it matters<textarea name="rationale" required minLength={10} maxLength={800} /></label><button type="submit">Expand the frontier</button></form>}
      {message && <p className="form-note" role="status">{message}</p>}
    </div>
  );
}

function MissionPage({ slug }: { slug: string }) {
  const request = useCallback(() => getMission(slug), [slug]);
  const { data, error, reload } = useRemoteData<MissionResponse>(request, 1_250);
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (!data) return <Loading />;
  const open = data.needs.filter((need) => need.status === "open");
  const reviewing = data.needs.filter((need) => need.status === "awaiting_review");
  const resolved = data.needs.filter((need) => need.status === "resolved");
  return (
    <main><section className="mission-hero"><a href="/" className="back-link">← All missions</a><span className="eyebrow">{data.mission.type.toUpperCase()} MISSION</span><h1>{data.mission.title}</h1><p>{data.mission.goal}</p><div className="mini-metrics"><span><strong>{data.counts.open}</strong> Needs help</span><span><strong>{data.counts.awaiting_review}</strong> Needs review</span><span><strong>{data.counts.resolved}</strong> Resolved</span></div></section>
      <div className="frontier-board"><NeedColumn title="Needs help" marker="○" needs={open} reload={reload} /><NeedColumn title="Needs review" marker="?" needs={reviewing} reload={reload} /><NeedColumn title="Resolved" marker="✓" needs={resolved} reload={reload} /></div>
      <ProposeForm mission={data.mission} completed={reload} />
    </main>
  );
}

function ContributionPage({ id }: { id: string }) {
  const request = useCallback(() => getContribution(id), [id]);
  const { data, error, reload } = useRemoteData<ContributionResponse>(request);
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <main className="detail-page"><a className="back-link" href={"/m/" + data.mission.slug}>← {data.mission.title}</a><span className="eyebrow">CONTRIBUTION</span><h1>{data.need.title}</h1><div className="detail-grid"><article className="detail-card"><span className="detail-label">PROPOSAL</span><h2>{data.contribution.summary}</h2><p>{data.contribution.result.answer}</p>{data.contribution.evidence.map((item) => <a href={item.url} key={item.url} rel="noreferrer" target="_blank">{item.title} ↗</a>)}</article><aside className="provenance-card"><span className="detail-label">PROVENANCE</span><strong>{data.contribution.actor_label}</strong><span>{relativeTime(data.contribution.created_at)}</span><span className="state-pill">{data.need.status.replace("_", " ")}</span>{data.reviews.map((review) => <div className="review-record" key={review.id}><b>{review.verdict}</b><p>{review.reason}</p><small>{review.reviewer_label}</small></div>)}</aside></div></main>
  );
}

export default function App() {
  const tools = useWebMCPTools();
  const mission = /^\/m\/([^/]+)$/.exec(window.location.pathname);
  const contribution = /^\/contributions\/([^/]+)$/.exec(window.location.pathname);
  let page: ReactNode = <HomePage />;
  if (mission) page = <MissionPage slug={decodeURIComponent(mission[1])} />;
  if (contribution) page = <ContributionPage id={decodeURIComponent(contribution[1])} />;
  return <Shell tools={tools}>{page}</Shell>;
}
