ALTER TABLE quests ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1));

UPDATE quests
SET is_demo = 1
WHERE id IN (
  'quest_open_cancer_research',
  'quest_accessible_hcmc',
  'quest_webmcp_documentation'
);
