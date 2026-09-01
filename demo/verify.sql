-- Fails atomically when the deterministic demo fixture is incomplete.
-- Run after demo/seed.sql. It only examines records with the `demo_` prefix.

CREATE TEMP TABLE demo_seed_assertions (
  passed INTEGER NOT NULL CHECK (passed = 1)
);

INSERT INTO demo_seed_assertions (passed)
SELECT COUNT(*) = 4
FROM organizations
WHERE id GLOB 'demo_org_*'
  AND is_demo = 1
  AND verification_status = 'unverified';

INSERT INTO demo_seed_assertions (passed)
SELECT COUNT(*) = 8
FROM quests
WHERE id GLOB 'demo_quest_*';

INSERT INTO demo_seed_assertions (passed)
SELECT COUNT(*) = 10
FROM challenges
WHERE id GLOB 'demo_challenge_*'
  AND status = 'awaiting_review';

INSERT INTO demo_seed_assertions (passed)
SELECT COUNT(*) = 15
FROM challenges
WHERE id GLOB 'demo_challenge_*'
  AND status = 'open';

INSERT INTO demo_seed_assertions (passed)
SELECT COUNT(*) = 17
FROM challenges
WHERE id GLOB 'demo_challenge_*'
  AND status = 'resolved';

INSERT INTO demo_seed_assertions (passed)
SELECT COUNT(DISTINCT actor_session_id) = 12
FROM events
WHERE quest_id GLOB 'demo_quest_*'
  AND event_type IN (
    'challenge.created',
    'contribution.created',
    'review.supported',
    'review.challenged'
  );

INSERT INTO demo_seed_assertions (passed)
SELECT COUNT(*) = 3
FROM contributions
WHERE id GLOB 'demo_contribution_reopened_*'
  AND status = 'challenged';

INSERT INTO demo_seed_assertions (passed)
SELECT COUNT(*) = 100
FROM events
WHERE quest_id GLOB 'demo_quest_*';

DROP TABLE demo_seed_assertions;
