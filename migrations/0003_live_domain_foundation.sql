CREATE TABLE organizations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  slug TEXT NOT NULL UNIQUE CHECK (
    length(slug) BETWEEN 3 AND 80
    AND slug GLOB '[a-z0-9]*'
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND slug NOT LIKE '-%'
    AND slug NOT LIKE '%-'
    AND slug NOT LIKE '%--%'
  ),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (length(trim(description)) <= 6000),
  category TEXT NOT NULL CHECK (category IN (
    'research', 'education', 'healthcare', 'company', 'nonprofit', 'government', 'funder', 'other'
  )),
  website_url TEXT CHECK (website_url IS NULL OR length(website_url) BETWEEN 1 AND 2048),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified')),
  ror_id TEXT CHECK (ror_id IS NULL OR length(ror_id) BETWEEN 1 AND 128),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE quests ADD COLUMN primary_organization_id TEXT
  REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX quests_by_primary_organization
  ON quests (primary_organization_id);
CREATE INDEX challenges_by_quest_status_updated
  ON challenges (quest_id, status, updated_at DESC, id DESC);
CREATE INDEX challenges_by_status_updated
  ON challenges (status, updated_at DESC, id DESC);
CREATE INDEX contributions_by_challenge_created
  ON contributions (challenge_id, created_at ASC, id ASC);
CREATE INDEX events_by_actor_sequence
  ON events (actor_session_id, sequence DESC);

DROP TRIGGER quests_created_event;
DROP TRIGGER challenges_created_event;
DROP TRIGGER contributions_apply;
DROP TRIGGER reviews_apply;

CREATE TRIGGER quests_created_event
AFTER INSERT ON quests
FOR EACH ROW
BEGIN
  INSERT INTO events (
    quest_id, entity_id, event_type, actor_session_id, summary, created_at
  ) VALUES (
    NEW.id, NEW.id, 'quest.created', NEW.created_by_session_id,
    'New Quest: ' || NEW.title, NEW.created_at
  );
END;

CREATE TRIGGER challenges_created_event
AFTER INSERT ON challenges
FOR EACH ROW
BEGIN
  INSERT INTO events (
    quest_id, entity_id, event_type, actor_session_id, summary, created_at
  ) VALUES (
    NEW.quest_id, NEW.id, 'challenge.created', NEW.created_by_session_id,
    'New Challenge: ' || NEW.title, NEW.created_at
  );
END;

CREATE TRIGGER contributions_apply
AFTER INSERT ON contributions
FOR EACH ROW
BEGIN
  UPDATE challenges
  SET status = 'awaiting_review', updated_at = NEW.created_at
  WHERE id = NEW.challenge_id AND status = 'open';

  INSERT INTO events (
    quest_id, entity_id, event_type, actor_session_id, summary, created_at
  )
  SELECT quest_id, NEW.id, 'contribution.created', NEW.session_id,
    'Contribution submitted: ' || title, NEW.created_at
  FROM challenges WHERE id = NEW.challenge_id;
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
  SET status = CASE NEW.verdict
      WHEN 'support' THEN 'resolved'
      WHEN 'challenge' THEN 'open'
    END,
    updated_at = NEW.created_at
  WHERE id = (SELECT challenge_id FROM contributions WHERE id = NEW.contribution_id);

  INSERT INTO events (
    quest_id, entity_id, event_type, actor_session_id, summary, created_at
  )
  SELECT challenges.quest_id, NEW.id,
    CASE NEW.verdict
      WHEN 'support' THEN 'review.supported'
      WHEN 'challenge' THEN 'review.challenged'
    END,
    NEW.reviewer_session_id,
    CASE NEW.verdict
      WHEN 'support' THEN 'Resolved: ' || challenges.title
      WHEN 'challenge' THEN 'Reopened: ' || challenges.title
    END,
    NEW.created_at
  FROM contributions
  JOIN challenges ON challenges.id = contributions.challenge_id
  WHERE contributions.id = NEW.contribution_id;
END;
