import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
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

export function ChallengeInspector({
  challengeId,
  onClose,
  onQuestNavigate,
}: {
  challengeId: string;
  onClose: () => void;
  onQuestNavigate: (slug: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const inspector = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const request = useCallback(() => getChallenge(challengeId), [challengeId]);
  const { data, error, loading, reload } = useRemoteData(request);
  const close = useCallback(() => {
    inspector.current?.close();
    onCloseRef.current();
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = inspector.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [close]);

  const closeOnBackdrop = useCallback((event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) close();
  }, [close]);

  const closeOnCancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    close();
  }, [close]);

  return createPortal(
    <dialog ref={inspector} className="challenge-inspector" aria-label="Challenge inspector" onCancel={closeOnCancel} onClick={closeOnBackdrop}>
      <div className="inspector-heading">
        <span>CHALLENGE INSPECTOR</span>
        <button autoFocus className="icon-button" type="button" onClick={onClose} aria-label="Close Challenge inspector">×</button>
      </div>
      {loading && !data ? <p className="empty-copy">Loading public Challenge history…</p> : null}
      {error && !data ? <div className="error-panel"><p>{error}</p><button type="button" onClick={reload}>Try again</button></div> : null}
      {data ? <InspectorContent data={data} onQuestNavigate={onQuestNavigate} /> : null}
    </dialog>,
    document.body,
  );
}

function InspectorContent({ data, onQuestNavigate }: { data: ChallengeDetailResponse; onQuestNavigate: (slug: string) => (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const organization = data.quest.organization;
  return (
    <div className="inspector-content">
      <div className="inspector-context">
        <a href={`/q/${data.quest.slug}`} onClick={onQuestNavigate(data.quest.slug)}>{data.quest.title}</a>
        <span>{data.quest.is_demo ? "DEMO · " : ""}{organization ? organization.name : "Community Quest"}</span>
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
