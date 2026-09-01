import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { getChallenge } from "../api";
import type { ChallengeDetailResponse } from "../contracts";
import { useRemoteData } from "../useRemoteData";

function EvidenceLinks({ evidence }: { evidence: ChallengeDetailResponse["contributions"][number]["evidence"] }) {
  if (evidence.length === 0) return <p className="empty-copy">No evidence links supplied.</p>;
  return (
    <ul className="evidence-list">
      {evidence.map((item) => (
        <li key={`${item.url}-${item.title}`}>
          <a href={item.url} rel="noopener noreferrer" target="_blank">{item.title} ↗</a>
          {item.note ? <p>{item.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function ContributionState({ status }: { status: "pending" | "accepted" | "challenged" }) {
  if (status === "accepted") return <span className="state-pill is-result">RESULT</span>;
  if (status === "pending") return <span className="state-pill is-review">AWAITING REVIEW</span>;
  return <span className="state-pill">CHALLENGED</span>;
}

const focusableSelector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function ChallengeInspector({
  challengeId,
  onClose,
  onQuestNavigate,
}: {
  challengeId: string;
  onClose: () => void;
  onQuestNavigate: (slug: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const request = useCallback(() => getChallenge(challengeId), [challengeId]);
  const { data, error, loading, reload } = useRemoteData(request);
  const close = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const appRoot = document.getElementById("root");
    const previousInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    const retainFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(inspector.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", retainFocus);
    return () => {
      window.removeEventListener("keydown", retainFocus);
      if (appRoot) appRoot.inert = previousInert;
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, [close]);

  return createPortal(
    <div className="inspector-backdrop" onMouseDown={onClose}>
      <aside ref={inspector} className="challenge-inspector" aria-label="Challenge inspector" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="inspector-heading">
          <span>CHALLENGE INSPECTOR</span>
          <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Close Challenge inspector">×</button>
        </div>
        {loading && !data ? <p className="empty-copy">Loading public Challenge history…</p> : null}
        {error && !data ? <div className="error-panel"><p>{error}</p><button type="button" onClick={reload}>Try again</button></div> : null}
        {data ? <InspectorContent data={data} onQuestNavigate={onQuestNavigate} /> : null}
      </aside>
    </div>,
    document.body,
  );
}

function InspectorContent({ data, onQuestNavigate }: { data: ChallengeDetailResponse; onQuestNavigate: (slug: string) => (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const organization = data.quest.organization;
  return (
    <div className="inspector-content">
      <div className="inspector-context">
        <a href={`/q/${data.quest.slug}`} onClick={onQuestNavigate(data.quest.slug)}>{data.quest.title}</a>
        {organization ? <span>{organization.is_demo ? "DEMO · " : ""}{organization.name}</span> : <span>Community Quest</span>}
      </div>
      <h2 id="inspector-title">{data.challenge.title}</h2>
      <p className="inspector-description">{data.challenge.description}</p>
      <div className="inspector-status">{data.challenge.status.replaceAll("_", " ")}</div>
      {data.contributions.length === 0 ? <p className="empty-copy">OPEN FOR CONTRIBUTION</p> : null}
      <div className="contribution-history">
        {data.contributions.map((contribution) => (
          <article className="contribution-record" key={contribution.id}>
            <div className="record-heading">
              <ContributionState status={contribution.status} />
              <span>{contribution.actor_label}</span>
              <time dateTime={contribution.created_at}>{new Date(contribution.created_at).toLocaleString()}</time>
            </div>
            <h3>{contribution.summary}</h3>
            <p className="plain-content">{contribution.content}</p>
            <h4>Evidence</h4>
            <EvidenceLinks evidence={contribution.evidence} />
            {contribution.review ? (
              <section className="review-record">
                <span className="detail-label">{contribution.review.verdict === "support" ? "SUPPORTED REVIEW" : "CHALLENGING REVIEW"}</span>
                <p>{contribution.review.reason}</p>
                <EvidenceLinks evidence={contribution.review.evidence} />
                <small>{contribution.review.reviewer_label} · {new Date(contribution.review.created_at).toLocaleString()}</small>
              </section>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
