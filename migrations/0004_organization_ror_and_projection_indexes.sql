CREATE TRIGGER organizations_require_canonical_ror_id_on_insert
BEFORE INSERT ON organizations
FOR EACH ROW
WHEN NEW.ror_id IS NOT NULL
  AND NEW.ror_id NOT GLOB 'https://ror.org/0[0-9a-z][0-9a-z][0-9a-z][0-9a-z][0-9a-z][0-9a-z][0-9a-z][0-9a-z]'
BEGIN
  SELECT RAISE(ABORT, 'invalid_ror_id');
END;

CREATE TRIGGER organizations_require_canonical_ror_id_on_update
BEFORE UPDATE OF ror_id ON organizations
FOR EACH ROW
WHEN NEW.ror_id IS NOT NULL
  AND NEW.ror_id NOT GLOB 'https://ror.org/0[0-9a-z][0-9a-z][0-9a-z][0-9a-z][0-9a-z][0-9a-z][0-9a-z][0-9a-z]'
BEGIN
  SELECT RAISE(ABORT, 'invalid_ror_id');
END;

CREATE INDEX events_by_contributor_recency
  ON events (actor_session_id, sequence DESC)
  WHERE actor_session_id IS NOT NULL
    AND event_type IN ('challenge.created', 'contribution.created', 'review.supported', 'review.challenged');
