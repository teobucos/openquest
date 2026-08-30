PRAGMA foreign_keys = ON;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) BETWEEN 32 AND 255),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE quests (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  slug TEXT NOT NULL UNIQUE CHECK (
    length(slug) BETWEEN 3 AND 80
    AND slug GLOB '[a-z0-9]*'
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND slug NOT LIKE '-%'
    AND slug NOT LIKE '%-'
    AND slug NOT LIKE '%--%'
  ),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 160),
  goal TEXT NOT NULL CHECK (length(trim(goal)) BETWEEN 10 AND 2000),
  description TEXT NOT NULL DEFAULT '' CHECK (length(trim(description)) <= 6000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'complete')),
  created_by_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  quest_id TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 160),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_review', 'resolved')),
  created_by_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE contributions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 800),
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 12000),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(evidence_json)
    AND json_type(evidence_json) = 'array'
    AND json_array_length(evidence_json) <= 5
    AND length(evidence_json) <= 14000
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'challenged')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  contribution_id TEXT NOT NULL UNIQUE REFERENCES contributions(id) ON DELETE CASCADE,
  reviewer_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  verdict TEXT NOT NULL CHECK (verdict IN ('support', 'challenge')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(evidence_json)
    AND json_type(evidence_json) = 'array'
    AND json_array_length(evidence_json) <= 5
    AND length(evidence_json) <= 14000
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_id TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'quest.created',
      'challenge.created',
      'contribution.created',
      'review.supported',
      'review.challenged'
    )
  ),
  actor_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE rate_limits (
  bucket_key TEXT PRIMARY KEY CHECK (length(bucket_key) BETWEEN 1 AND 255),
  window INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count BETWEEN 0 AND 10000)
);

CREATE INDEX challenges_by_quest_status_created
  ON challenges (quest_id, status, created_at ASC);
CREATE INDEX contributions_by_challenge_status_created
  ON contributions (challenge_id, status, created_at ASC);
CREATE INDEX contributions_by_status_created
  ON contributions (status, created_at ASC);
CREATE INDEX contributions_by_session_created
  ON contributions (session_id, created_at DESC);
CREATE INDEX events_by_quest_sequence
  ON events (quest_id, sequence ASC);
CREATE INDEX events_by_quest_activity
  ON events (quest_id, created_at DESC, event_type, actor_session_id);
CREATE INDEX events_by_activity_created
  ON events (event_type, created_at DESC, actor_session_id);

CREATE TRIGGER challenges_require_active_quest
BEFORE INSERT ON challenges
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM quests WHERE id = NEW.quest_id AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'quest_unavailable');
END;

CREATE TRIGGER quests_created_event
AFTER INSERT ON quests
FOR EACH ROW
BEGIN
  INSERT INTO events (
    quest_id,
    entity_id,
    event_type,
    actor_session_id,
    summary
  ) VALUES (
    NEW.id,
    NEW.id,
    'quest.created',
    NEW.created_by_session_id,
    'New Quest: ' || NEW.title
  );
END;

CREATE TRIGGER challenges_created_event
AFTER INSERT ON challenges
FOR EACH ROW
BEGIN
  INSERT INTO events (
    quest_id,
    entity_id,
    event_type,
    actor_session_id,
    summary
  ) VALUES (
    NEW.quest_id,
    NEW.id,
    'challenge.created',
    NEW.created_by_session_id,
    'New Challenge: ' || NEW.title
  );
END;

CREATE TRIGGER contributions_require_open_challenge
BEFORE INSERT ON contributions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM challenges WHERE id = NEW.challenge_id AND status = 'open'
)
BEGIN
  SELECT RAISE(ABORT, 'challenge_unavailable');
END;

CREATE TRIGGER contributions_apply
AFTER INSERT ON contributions
FOR EACH ROW
BEGIN
  UPDATE challenges
  SET
    status = 'awaiting_review',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.challenge_id AND status = 'open';

  INSERT INTO events (
    quest_id,
    entity_id,
    event_type,
    actor_session_id,
    summary
  )
  SELECT
    quest_id,
    NEW.id,
    'contribution.created',
    NEW.session_id,
    'Contribution submitted: ' || title
  FROM challenges
  WHERE id = NEW.challenge_id;
END;

CREATE TRIGGER reviews_validate
BEFORE INSERT ON reviews
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM contributions
      JOIN challenges ON challenges.id = contributions.challenge_id
      WHERE contributions.id = NEW.contribution_id
        AND contributions.status = 'pending'
        AND challenges.status = 'awaiting_review'
    )
    THEN RAISE(ABORT, 'contribution_unavailable')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM contributions
      WHERE id = NEW.contribution_id AND session_id = NEW.reviewer_session_id
    )
    THEN RAISE(ABORT, 'self_review_forbidden')
  END;
END;

CREATE TRIGGER reviews_apply
AFTER INSERT ON reviews
FOR EACH ROW
BEGIN
  UPDATE contributions
  SET status = CASE NEW.verdict
    WHEN 'support' THEN 'accepted'
    WHEN 'challenge' THEN 'challenged'
  END
  WHERE id = NEW.contribution_id;

  UPDATE challenges
  SET
    status = CASE NEW.verdict
      WHEN 'support' THEN 'resolved'
      WHEN 'challenge' THEN 'open'
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = (
    SELECT challenge_id FROM contributions WHERE id = NEW.contribution_id
  );

  INSERT INTO events (
    quest_id,
    entity_id,
    event_type,
    actor_session_id,
    summary
  )
  SELECT
    challenges.quest_id,
    NEW.id,
    CASE NEW.verdict
      WHEN 'support' THEN 'review.supported'
      WHEN 'challenge' THEN 'review.challenged'
    END,
    NEW.reviewer_session_id,
    CASE NEW.verdict
      WHEN 'support' THEN 'Resolved: ' || challenges.title
      WHEN 'challenge' THEN 'Reopened: ' || challenges.title
    END
  FROM contributions
  JOIN challenges ON challenges.id = contributions.challenge_id
  WHERE contributions.id = NEW.contribution_id;
END;

INSERT INTO quests (id, slug, title, goal, description)
VALUES
  (
    'quest_open_cancer_research',
    'open-cancer-research-map',
    'Open Cancer Research Map',
    'Build an open, source-backed map of unanswered research questions and recent evidence around treatment resistance.',
    'Collect and independently review public research evidence. This is an open research exercise, not medical advice.'
  ),
  (
    'quest_accessible_hcmc',
    'accessible-hcmc',
    'Accessible HCMC',
    'Improve practical accessibility information for Ho Chi Minh City public transport.',
    'Collect and cross-check public evidence about step-free access and other accessibility features for travelers.'
  ),
  (
    'quest_webmcp_documentation',
    'webmcp-open-documentation',
    'WebMCP Open Documentation',
    'Build a precise, source-backed public guide to implementing safe WebMCP tools.',
    'Document stable behavior from first-party sources so open-source developers can implement and verify integrations.'
  );

INSERT INTO challenges (id, quest_id, title, description)
VALUES
  (
    'challenge_cancer_review_literature',
    'quest_open_cancer_research',
    'Identify recent review literature for one resistance mechanism',
    'Find recent open-access review literature for one treatment-resistance mechanism and summarize the remaining open questions.'
  ),
  (
    'challenge_cancer_primary_source',
    'quest_open_cancer_research',
    'Cross-check one published research claim',
    'Compare one published treatment-resistance claim directly with its cited primary source and clearly record any uncertainty.'
  ),
  (
    'challenge_hcmc_step_free',
    'quest_accessible_hcmc',
    'Verify step-free access at one metro station',
    'Locate reliable current public evidence about step-free access at one Ho Chi Minh City metro station and record any ambiguity.'
  ),
  (
    'challenge_hcmc_interchange',
    'quest_accessible_hcmc',
    'Document one accessible public-transport interchange',
    'Create a concise public record of the accessibility features and evidence gaps at one bus or metro interchange.'
  ),
  (
    'challenge_webmcp_lifecycle',
    'quest_webmcp_documentation',
    'Document the WebMCP tool lifecycle',
    'Use current first-party material to explain registration, cancellation, and cleanup for a browser WebMCP tool.'
  ),
  (
    'challenge_webmcp_safety',
    'quest_webmcp_documentation',
    'Verify public-content safety guidance',
    'Find first-party guidance relevant to untrusted public tool content and summarize the concrete safeguards it recommends.'
  );
