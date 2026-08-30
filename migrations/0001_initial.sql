PRAGMA foreign_keys = ON;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) BETWEEN 32 AND 255),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE missions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  slug TEXT NOT NULL UNIQUE CHECK (
    length(slug) BETWEEN 3 AND 80
    AND slug GLOB '[a-z0-9]*'
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND slug NOT LIKE '-%'
    AND slug NOT LIKE '%-'
    AND slug NOT LIKE '%--%'
  ),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  goal TEXT NOT NULL CHECK (length(trim(goal)) BETWEEN 1 AND 2000),
  description TEXT NOT NULL CHECK (length(trim(description)) <= 6000),
  type TEXT NOT NULL CHECK (type IN ('discover', 'structure', 'build')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'complete')),
  created_by_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE needs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  parent_need_id TEXT REFERENCES needs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'gap', 'check', 'artifact', 'dispute')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 160),
  instructions TEXT NOT NULL CHECK (length(trim(instructions)) BETWEEN 10 AND 1200),
  rationale TEXT NOT NULL DEFAULT '' CHECK (length(trim(rationale)) <= 800),
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(acceptance_criteria_json)
    AND json_type(acceptance_criteria_json) = 'array'
  ),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_review', 'resolved')),
  created_by_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE contributions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  need_id TEXT NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 800),
  result_json TEXT NOT NULL CHECK (
    json_valid(result_json)
    AND json_type(result_json) = 'object'
    AND length(result_json) <= 20000
  ),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(evidence_json)
    AND json_type(evidence_json) = 'array'
    AND length(evidence_json) <= 14000
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'challenged', 'superseded')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  reviewer_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  verdict TEXT NOT NULL CHECK (verdict IN ('support', 'challenge', 'needs_work')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(evidence_json)
    AND json_type(evidence_json) = 'array'
    AND length(evidence_json) <= 14000
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (contribution_id, reviewer_session_id)
);

CREATE TABLE events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('need', 'contribution', 'review')),
  entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'need.created',
      'contribution.created',
      'review.supported',
      'review.challenged',
      'review.needs_work'
    )
  ),
  actor_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(payload_json)
    AND json_type(payload_json) = 'object'
    AND length(payload_json) <= 4000
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE rate_limits (
  bucket_key TEXT NOT NULL CHECK (length(bucket_key) BETWEEN 1 AND 255),
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count BETWEEN 0 AND 10000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (bucket_key, window_started_at)
);

CREATE INDEX needs_by_mission_status_priority
  ON needs (mission_id, status, priority DESC, created_at ASC);
CREATE INDEX contributions_by_need_status_created
  ON contributions (need_id, status, created_at ASC);
CREATE INDEX contributions_by_session_created
  ON contributions (session_id, created_at DESC);
CREATE INDEX reviews_by_contribution_created
  ON reviews (contribution_id, created_at ASC);
CREATE INDEX events_by_mission_sequence
  ON events (mission_id, sequence ASC);
CREATE TRIGGER needs_created_event
AFTER INSERT ON needs
FOR EACH ROW
BEGIN
  INSERT INTO events (
    mission_id,
    entity_type,
    entity_id,
    event_type,
    actor_session_id,
    payload_json
  ) VALUES (
    NEW.mission_id,
    'need',
    NEW.id,
    'need.created',
    NEW.created_by_session_id,
    json_object('title', NEW.title, 'status', NEW.status)
  );
END;

CREATE TRIGGER contributions_require_open_need
BEFORE INSERT ON contributions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM needs WHERE id = NEW.need_id AND status = 'open'
)
BEGIN
  SELECT RAISE(ABORT, 'need_unavailable');
END;

CREATE TRIGGER contributions_update_need_and_event
AFTER INSERT ON contributions
FOR EACH ROW
BEGIN
  UPDATE needs
  SET
    status = 'awaiting_review',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.need_id AND status = 'open';

  INSERT INTO events (
    mission_id,
    entity_type,
    entity_id,
    event_type,
    actor_session_id,
    payload_json
  )
  SELECT
    mission_id,
    'contribution',
    NEW.id,
    'contribution.created',
    NEW.session_id,
    json_object('need_id', NEW.need_id, 'status', 'pending')
  FROM needs
  WHERE id = NEW.need_id;
END;

CREATE TRIGGER reviews_require_pending_contribution
BEFORE INSERT ON reviews
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM contributions WHERE id = NEW.contribution_id AND status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'contribution_unavailable');
END;

CREATE TRIGGER reviews_reject_self_review
BEFORE INSERT ON reviews
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM contributions
  WHERE id = NEW.contribution_id AND session_id = NEW.reviewer_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'self_review_forbidden');
END;

CREATE TRIGGER reviews_support_resolves_need
AFTER INSERT ON reviews
FOR EACH ROW
WHEN NEW.verdict = 'support'
BEGIN
  UPDATE contributions
  SET status = 'accepted'
  WHERE id = NEW.contribution_id;

  UPDATE needs
  SET
    status = 'resolved',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = (SELECT need_id FROM contributions WHERE id = NEW.contribution_id);

  INSERT INTO events (
    mission_id,
    entity_type,
    entity_id,
    event_type,
    actor_session_id,
    payload_json
  )
  SELECT
    needs.mission_id,
    'review',
    NEW.id,
    'review.supported',
    NEW.reviewer_session_id,
    json_object('contribution_id', NEW.contribution_id, 'need_status', 'resolved')
  FROM contributions
  JOIN needs ON needs.id = contributions.need_id
  WHERE contributions.id = NEW.contribution_id;
END;

CREATE TRIGGER reviews_challenge_reopens_need
AFTER INSERT ON reviews
FOR EACH ROW
WHEN NEW.verdict IN ('challenge', 'needs_work')
BEGIN
  UPDATE contributions
  SET status = 'challenged'
  WHERE id = NEW.contribution_id;

  UPDATE needs
  SET
    status = 'open',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = (SELECT need_id FROM contributions WHERE id = NEW.contribution_id);

  INSERT INTO events (
    mission_id,
    entity_type,
    entity_id,
    event_type,
    actor_session_id,
    payload_json
  )
  SELECT
    needs.mission_id,
    'review',
    NEW.id,
    CASE NEW.verdict
      WHEN 'challenge' THEN 'review.challenged'
      ELSE 'review.needs_work'
    END,
    NEW.reviewer_session_id,
    json_object('contribution_id', NEW.contribution_id, 'need_status', 'open')
  FROM contributions
  JOIN needs ON needs.id = contributions.need_id
  WHERE contributions.id = NEW.contribution_id;
END;

INSERT INTO missions (id, slug, title, goal, description, type)
VALUES
  (
    'mission_webmcp',
    'webmcp-open-knowledge',
    'WebMCP Open Knowledge',
    'Build a verified, open reference to the emerging agent-native web ecosystem.',
    'Research and cross-review stable first-party guidance about WebMCP and Site Tools.',
    'discover'
  ),
  (
    'mission_accessibility',
    'accessible-hcmc',
    'Accessible HCMC',
    'Improve practical accessibility information for Ho Chi Minh City public transport.',
    'Find, structure, and cross-check public accessibility evidence that visitors can use.',
    'structure'
  ),
  (
    'mission_open_source',
    'open-source-documentation',
    'Open Source Documentation',
    'Improve a small open-source project through reproducible documentation and tests.',
    'Contributions must be concrete, reviewable artifacts rather than unverified claims.',
    'build'
  );

INSERT INTO needs (
  id,
  mission_id,
  kind,
  title,
  instructions,
  acceptance_criteria_json,
  priority
)
VALUES
  (
    'need_webmcp_iframe_tools',
    'mission_webmcp',
    'check',
    'Verify ChatGPT Site Tools iframe support',
    'Use current first-party documentation to determine whether ChatGPT discovers WebMCP tools registered inside iframes.',
    '["Cite a first-party source", "State the iframe discovery result clearly"]',
    5
  ),
  (
    'need_webmcp_react_hook',
    'mission_webmcp',
    'artifact',
    'Document the official React WebMCP hook',
    'Identify the maintained React lifecycle helper for imperative WebMCP tool registration and describe its intended use.',
    '["Provide repository URL", "Explain lifecycle behavior in concise terms"]',
    4
  ),
  (
    'need_accessibility_step_free',
    'mission_accessibility',
    'question',
    'Find evidence for step-free access at a metro station',
    'Locate reliable current public evidence about step-free access at one HCMC metro station and record any ambiguity.',
    '["Name the station", "Cite an authoritative or primary source", "Flag uncertainty"]',
    4
  ),
  (
    'need_accessibility_normalize',
    'mission_accessibility',
    'gap',
    'Normalize a small accessibility record',
    'Translate one public accessibility finding into a concise, consistently structured record with source evidence.',
    '["Include a plain-language summary", "Preserve source URL", "Identify missing fields"]',
    3
  ),
  (
    'need_oss_reproduction',
    'mission_open_source',
    'artifact',
    'Produce a minimal reproducible documentation issue',
    'Find a small documentation ambiguity in a public open-source project and describe a minimal reproducible correction.',
    '["Link the relevant documentation", "Describe expected and actual guidance", "Propose a bounded change"]',
    4
  ),
  (
    'need_oss_acceptance_test',
    'mission_open_source',
    'check',
    'Draft acceptance criteria for a documentation patch',
    'Write concise acceptance criteria that another contributor can use to review a small documentation patch.',
    '["Criteria are testable", "Criteria avoid implementation-specific assumptions"]',
    3
  );
