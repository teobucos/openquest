CREATE INDEX challenges_by_status_created_id
  ON challenges (status, created_at ASC, id ASC);
