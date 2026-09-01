-- OpenQuest's deterministic fictional demo world.
--
-- Prerequisite: the additive organization migration has created
-- `organizations` and `quests.primary_organization_id`. This seed does not
-- rewrite migration history and never deletes existing public records.
--
-- Expected demo-only final state (see expected-state.json):
--   4 organizations, 8 quests, 10 awaiting review, 15 open, 17 resolved,
--   12 Contributors, 3 reopened histories, and 100 public domain events.

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO sessions (id, token_hash, created_at) VALUES
  ('demo_session_01', 'd000000000000000000000000000000000000000000000000000000000000001', '2026-07-01T08:00:00.000Z'),
  ('demo_session_02', 'd000000000000000000000000000000000000000000000000000000000000002', '2026-07-01T08:01:00.000Z'),
  ('demo_session_03', 'd000000000000000000000000000000000000000000000000000000000000003', '2026-07-01T08:02:00.000Z'),
  ('demo_session_04', 'd000000000000000000000000000000000000000000000000000000000000004', '2026-07-01T08:03:00.000Z'),
  ('demo_session_05', 'd000000000000000000000000000000000000000000000000000000000000005', '2026-07-01T08:04:00.000Z'),
  ('demo_session_06', 'd000000000000000000000000000000000000000000000000000000000000006', '2026-07-01T08:05:00.000Z'),
  ('demo_session_07', 'd000000000000000000000000000000000000000000000000000000000000007', '2026-07-01T08:06:00.000Z'),
  ('demo_session_08', 'd000000000000000000000000000000000000000000000000000000000000008', '2026-07-01T08:07:00.000Z'),
  ('demo_session_09', 'd000000000000000000000000000000000000000000000000000000000000009', '2026-07-01T08:08:00.000Z'),
  ('demo_session_10', 'd000000000000000000000000000000000000000000000000000000000000010', '2026-07-01T08:09:00.000Z'),
  ('demo_session_11', 'd000000000000000000000000000000000000000000000000000000000000011', '2026-07-01T08:10:00.000Z'),
  ('demo_session_12', 'd000000000000000000000000000000000000000000000000000000000000012', '2026-07-01T08:11:00.000Z');

INSERT OR IGNORE INTO organizations (
  id, slug, name, description, category, website_url, verification_status,
  ror_id, is_demo, created_at, updated_at
) VALUES
  ('demo_org_lattice', 'lattice-field-station', 'Lattice Field Station', 'A fictional field-notes collective for the OpenQuest demo.', 'research', 'https://example.com/lattice-field-station', 'unverified', NULL, 1, '2026-07-01T09:00:00.000Z', '2026-07-01T09:00:00.000Z'),
  ('demo_org_moonwater', 'moonwater-learning-lab', 'Moonwater Learning Lab', 'A fictional public-learning studio for the OpenQuest demo.', 'education', 'https://example.com/moonwater-learning-lab', 'unverified', NULL, 1, '2026-07-01T09:01:00.000Z', '2026-07-01T09:01:00.000Z'),
  ('demo_org_northwind', 'northwind-civic-studio', 'Northwind Civic Studio', 'A fictional civic design studio for the OpenQuest demo.', 'nonprofit', 'https://example.com/northwind-civic-studio', 'unverified', NULL, 1, '2026-07-01T09:02:00.000Z', '2026-07-01T09:02:00.000Z'),
  ('demo_org_orbit', 'orbit-public-works', 'Orbit Public Works', 'A fictional public-interest engineering group for the OpenQuest demo.', 'other', 'https://example.com/orbit-public-works', 'unverified', NULL, 1, '2026-07-01T09:03:00.000Z', '2026-07-01T09:03:00.000Z');

INSERT OR IGNORE INTO quests (
  id, slug, title, goal, description, status, primary_organization_id,
  created_by_session_id, created_at, updated_at
) VALUES
  ('demo_quest_tide', 'tide-notes', 'Tide Notes', 'Build a fictional, source-backed guide to observing changing shoreline access.', 'Synthetic demo content about a fictional shoreline observation project.', 'active', 'demo_org_lattice', 'demo_session_01', '2026-07-02T09:00:00.000Z', '2026-07-18T10:00:00.000Z'),
  ('demo_quest_signal', 'signal-garden', 'Signal Garden', 'Create a fictional public map of low-power community signal experiments.', 'Synthetic demo content about small, public communication experiments.', 'active', 'demo_org_moonwater', 'demo_session_02', '2026-07-02T09:01:00.000Z', '2026-07-18T10:01:00.000Z'),
  ('demo_quest_steps', 'shared-steps', 'Shared Steps', 'Document fictional barriers and improvements in a neighborhood walking network.', 'Synthetic demo content about accessible public-space observations.', 'active', 'demo_org_northwind', 'demo_session_03', '2026-07-02T09:02:00.000Z', '2026-07-18T10:02:00.000Z'),
  ('demo_quest_air', 'open-air-ledger', 'Open Air Ledger', 'Compare fictional low-cost air observations with transparent public methods.', 'Synthetic demo content about reproducible local measurements.', 'active', 'demo_org_orbit', 'demo_session_04', '2026-07-02T09:03:00.000Z', '2026-07-18T10:03:00.000Z'),
  ('demo_quest_archive', 'neighborhood-archive', 'Neighborhood Archive', 'Preserve fictional public-memory prompts with clear provenance and review.', 'A community Quest with no organization affiliation.', 'active', NULL, 'demo_session_05', '2026-07-02T09:04:00.000Z', '2026-07-18T10:04:00.000Z'),
  ('demo_quest_food', 'table-commons', 'Table Commons', 'Collect fictional examples of resilient shared-meal infrastructure.', 'A community Quest with no organization affiliation.', 'active', NULL, 'demo_session_06', '2026-07-02T09:05:00.000Z', '2026-07-18T10:05:00.000Z'),
  ('demo_quest_water', 'water-window', 'Water Window', 'Map fictional public questions about visible urban water systems.', 'A community Quest with no organization affiliation.', 'active', NULL, 'demo_session_07', '2026-07-02T09:06:00.000Z', '2026-07-18T10:06:00.000Z'),
  ('demo_quest_tools', 'repair-atlas', 'Repair Atlas', 'Create a fictional public catalog of repair knowledge gaps.', 'A community Quest with no organization affiliation.', 'active', NULL, 'demo_session_08', '2026-07-02T09:07:00.000Z', '2026-07-18T10:07:00.000Z');

-- Forty-two Challenges: ten become awaiting review, seventeen resolve, three
-- reopen after challenged history, and twelve remain open without a Contribution.
INSERT OR IGNORE INTO challenges (id, quest_id, title, description, created_by_session_id, created_at, updated_at) VALUES
  ('demo_challenge_tide_01', 'demo_quest_tide', 'Compare two fictional tide-note formats', 'Compare two fictional public field-note formats and identify which preserves uncertainty more clearly.', 'demo_session_01', '2026-07-03T09:00:00.000Z', '2026-07-03T09:00:00.000Z'),
  ('demo_challenge_tide_02', 'demo_quest_tide', 'Map a fictional access observation', 'Describe a fictional shoreline access observation using only public and non-sensitive details.', 'demo_session_02', '2026-07-03T09:01:00.000Z', '2026-07-03T09:01:00.000Z'),
  ('demo_challenge_tide_03', 'demo_quest_tide', 'List uncertainty labels for tide notes', 'Propose clear uncertainty labels for a fictional tide-note data sheet.', 'demo_session_03', '2026-07-03T09:02:00.000Z', '2026-07-03T09:02:00.000Z'),
  ('demo_challenge_tide_04', 'demo_quest_tide', 'Check a fictional observation cadence', 'Review a fictional observation cadence and identify one transparent improvement.', 'demo_session_04', '2026-07-03T09:03:00.000Z', '2026-07-03T09:03:00.000Z'),
  ('demo_challenge_tide_05', 'demo_quest_tide', 'Draft a public tide-note glossary', 'Draft a concise fictional glossary for terms used in public shoreline notes.', 'demo_session_05', '2026-07-03T09:04:00.000Z', '2026-07-03T09:04:00.000Z'),
  ('demo_challenge_tide_06', 'demo_quest_tide', 'Compare fictional warning signs', 'Compare fictional public warning-sign language without making safety claims.', 'demo_session_06', '2026-07-03T09:05:00.000Z', '2026-07-03T09:05:00.000Z'),
  ('demo_challenge_signal_01', 'demo_quest_signal', 'Document a fictional signal relay', 'Document a fictional neighborhood signal relay and the public questions it raises.', 'demo_session_07', '2026-07-03T09:06:00.000Z', '2026-07-03T09:06:00.000Z'),
  ('demo_challenge_signal_02', 'demo_quest_signal', 'Compare low-power signal labels', 'Compare fictional labels for low-power signal experiments and recommend a clearer one.', 'demo_session_08', '2026-07-03T09:07:00.000Z', '2026-07-03T09:07:00.000Z'),
  ('demo_challenge_signal_03', 'demo_quest_signal', 'Summarize a fictional listening walk', 'Summarize a fictional public listening walk while preserving unknowns.', 'demo_session_09', '2026-07-03T09:08:00.000Z', '2026-07-03T09:08:00.000Z'),
  ('demo_challenge_signal_04', 'demo_quest_signal', 'Identify a public signal question', 'Identify one bounded fictional question for a public signal experiment.', 'demo_session_10', '2026-07-03T09:09:00.000Z', '2026-07-03T09:09:00.000Z'),
  ('demo_challenge_steps_01', 'demo_quest_steps', 'Describe a fictional curb crossing', 'Describe a fictional curb crossing observation and its evidence limitations.', 'demo_session_11', '2026-07-03T09:10:00.000Z', '2026-07-03T09:10:00.000Z'),
  ('demo_challenge_steps_02', 'demo_quest_steps', 'Compare fictional wayfinding prompts', 'Compare two fictional wayfinding prompts for a neighborhood walking network.', 'demo_session_12', '2026-07-03T09:11:00.000Z', '2026-07-03T09:11:00.000Z'),
  ('demo_challenge_steps_03', 'demo_quest_steps', 'Record an unresolved step count', 'Record a fictional step-count question that still needs public review.', 'demo_session_01', '2026-07-03T09:12:00.000Z', '2026-07-03T09:12:00.000Z'),
  ('demo_challenge_steps_04', 'demo_quest_steps', 'Review a fictional route note', 'Review a fictional public route note for clarity and respectful wording.', 'demo_session_02', '2026-07-03T09:13:00.000Z', '2026-07-03T09:13:00.000Z'),
  ('demo_challenge_steps_05', 'demo_quest_steps', 'Draft a walking-network question', 'Draft one precise fictional question about a shared walking network.', 'demo_session_03', '2026-07-03T09:14:00.000Z', '2026-07-03T09:14:00.000Z'),
  ('demo_challenge_air_01', 'demo_quest_air', 'Compare fictional sensor notes', 'Compare two fictional sensor notes and retain all stated uncertainty.', 'demo_session_04', '2026-07-03T09:15:00.000Z', '2026-07-03T09:15:00.000Z'),
  ('demo_challenge_air_02', 'demo_quest_air', 'Explain a fictional calibration gap', 'Explain one fictional calibration gap without claiming an environmental finding.', 'demo_session_05', '2026-07-03T09:16:00.000Z', '2026-07-03T09:16:00.000Z'),
  ('demo_challenge_air_03', 'demo_quest_air', 'List transparent measurement limits', 'List transparent fictional limits for a low-cost public measurement project.', 'demo_session_06', '2026-07-03T09:17:00.000Z', '2026-07-03T09:17:00.000Z'),
  ('demo_challenge_air_04', 'demo_quest_air', 'Describe a fictional sampling route', 'Describe a fictional sampling route using general public-location language.', 'demo_session_07', '2026-07-03T09:18:00.000Z', '2026-07-03T09:18:00.000Z'),
  ('demo_challenge_air_05', 'demo_quest_air', 'Check a public method summary', 'Check whether a fictional public method summary distinguishes observation from conclusion.', 'demo_session_08', '2026-07-03T09:19:00.000Z', '2026-07-03T09:19:00.000Z'),
  ('demo_challenge_archive_01', 'demo_quest_archive', 'Frame a fictional memory prompt', 'Frame a fictional public-memory prompt without asking for personal data.', 'demo_session_09', '2026-07-03T09:20:00.000Z', '2026-07-03T09:20:00.000Z'),
  ('demo_challenge_archive_02', 'demo_quest_archive', 'Compare fictional archive tags', 'Compare fictional archive tags and select labels that expose provenance.', 'demo_session_10', '2026-07-03T09:21:00.000Z', '2026-07-03T09:21:00.000Z'),
  ('demo_challenge_archive_03', 'demo_quest_archive', 'Document a fictional source gap', 'Document one fictional source gap for a public-memory item.', 'demo_session_11', '2026-07-03T09:22:00.000Z', '2026-07-03T09:22:00.000Z'),
  ('demo_challenge_archive_04', 'demo_quest_archive', 'Draft a provenance note', 'Draft a clear fictional provenance note for an archive contribution.', 'demo_session_12', '2026-07-03T09:23:00.000Z', '2026-07-03T09:23:00.000Z'),
  ('demo_challenge_archive_05', 'demo_quest_archive', 'Review a fictional public caption', 'Review a fictional public caption for neutrality and context.', 'demo_session_01', '2026-07-03T09:24:00.000Z', '2026-07-03T09:24:00.000Z'),
  ('demo_challenge_food_01', 'demo_quest_food', 'Map a fictional shared pantry', 'Map a fictional shared pantry question without making claims about a real service.', 'demo_session_02', '2026-07-03T09:25:00.000Z', '2026-07-03T09:25:00.000Z'),
  ('demo_challenge_food_02', 'demo_quest_food', 'Compare fictional meal notices', 'Compare fictional meal notices and preserve uncertainty about availability.', 'demo_session_03', '2026-07-03T09:26:00.000Z', '2026-07-03T09:26:00.000Z'),
  ('demo_challenge_food_03', 'demo_quest_food', 'Describe a fictional tool-share', 'Describe a fictional tool-share workflow using only synthetic information.', 'demo_session_04', '2026-07-03T09:27:00.000Z', '2026-07-03T09:27:00.000Z'),
  ('demo_challenge_food_04', 'demo_quest_food', 'List public food-system questions', 'List bounded fictional questions about a shared local food system.', 'demo_session_05', '2026-07-03T09:28:00.000Z', '2026-07-03T09:28:00.000Z'),
  ('demo_challenge_food_05', 'demo_quest_food', 'Check a fictional preparation guide', 'Check a fictional preparation guide for clear public provenance.', 'demo_session_06', '2026-07-03T09:29:00.000Z', '2026-07-03T09:29:00.000Z'),
  ('demo_challenge_water_01', 'demo_quest_water', 'Compare fictional water-window notes', 'Compare two fictional water-window notes and identify unresolved context.', 'demo_session_07', '2026-07-03T09:30:00.000Z', '2026-07-03T09:30:00.000Z'),
  ('demo_challenge_water_02', 'demo_quest_water', 'Describe a fictional runoff question', 'Describe one fictional runoff question without asserting a real-world condition.', 'demo_session_08', '2026-07-03T09:31:00.000Z', '2026-07-03T09:31:00.000Z'),
  ('demo_challenge_water_03', 'demo_quest_water', 'Draft a public observation template', 'Draft a fictional public observation template for visible water systems.', 'demo_session_09', '2026-07-03T09:32:00.000Z', '2026-07-03T09:32:00.000Z'),
  ('demo_challenge_water_04', 'demo_quest_water', 'Review a fictional drainage note', 'Review a fictional drainage note and name any unsupported inference.', 'demo_session_10', '2026-07-03T09:33:00.000Z', '2026-07-03T09:33:00.000Z'),
  ('demo_challenge_tools_01', 'demo_quest_tools', 'Document a fictional repair gap', 'Document a bounded fictional repair-knowledge gap for public review.', 'demo_session_11', '2026-07-03T09:34:00.000Z', '2026-07-03T09:34:00.000Z'),
  ('demo_challenge_tools_02', 'demo_quest_tools', 'Compare fictional repair labels', 'Compare fictional repair labels and identify one ambiguous term.', 'demo_session_12', '2026-07-03T09:35:00.000Z', '2026-07-03T09:35:00.000Z'),
  ('demo_challenge_tools_03', 'demo_quest_tools', 'Review a fictional maintenance note', 'Review a fictional maintenance note for clear limits and public context.', 'demo_session_01', '2026-07-03T09:36:00.000Z', '2026-07-03T09:36:00.000Z'),
  ('demo_challenge_tools_04', 'demo_quest_tools', 'Draft a fictional repair question', 'Draft one answerable fictional question for a public repair atlas.', 'demo_session_02', '2026-07-03T09:37:00.000Z', '2026-07-03T09:37:00.000Z'),
  ('demo_challenge_tools_05', 'demo_quest_tools', 'Check a fictional repair citation', 'Check a fictional repair citation summary for adequate provenance.', 'demo_session_03', '2026-07-03T09:38:00.000Z', '2026-07-03T09:38:00.000Z'),
  ('demo_challenge_tools_06', 'demo_quest_tools', 'Summarize a fictional repair test', 'Summarize a fictional repair test without presenting it as professional advice.', 'demo_session_04', '2026-07-03T09:39:00.000Z', '2026-07-03T09:39:00.000Z'),
  ('demo_challenge_tools_07', 'demo_quest_tools', 'List future fictional repair prompts', 'List future fictional prompts that would make the repair atlas more useful.', 'demo_session_05', '2026-07-03T09:40:00.000Z', '2026-07-03T09:40:00.000Z'),
  ('demo_challenge_tools_08', 'demo_quest_tools', 'Compare fictional repair instructions', 'Compare two fictional repair instructions for public clarity and caution.', 'demo_session_06', '2026-07-03T09:41:00.000Z', '2026-07-03T09:41:00.000Z');

-- Ten pending Contributions, one per Challenge, create the review portion of
-- the public work stream. Their content is deliberately synthetic.
WITH pending_contributions (
  id, challenge_id, session_id, summary, content, evidence_json, created_at
) AS (VALUES
  ('demo_contribution_pending_01', 'demo_challenge_tide_01', 'demo_session_07', 'Synthetic comparison ready for public Review.', 'This synthetic Contribution compares two fictional tide-note formats and keeps all uncertainty visible.', '[{"title":"Synthetic tide-note reference","url":"https://example.com/demo/tide-notes"}]', '2026-07-10T09:00:00.000Z'),
  ('demo_contribution_pending_02', 'demo_challenge_tide_02', 'demo_session_08', 'Synthetic access observation ready for Review.', 'This synthetic Contribution records a fictional shoreline access observation without making real-world claims.', '[{"title":"Synthetic access reference","url":"https://example.com/demo/access"}]', '2026-07-10T09:01:00.000Z'),
  ('demo_contribution_pending_03', 'demo_challenge_signal_01', 'demo_session_09', 'Synthetic signal relay note ready for Review.', 'This synthetic Contribution documents a fictional signal relay and its bounded public questions.', '[{"title":"Synthetic relay reference","url":"https://example.com/demo/relay"}]', '2026-07-10T09:02:00.000Z'),
  ('demo_contribution_pending_04', 'demo_challenge_signal_02', 'demo_session_10', 'Synthetic signal-label comparison ready for Review.', 'This synthetic Contribution compares fictional labels and explains the selected wording.', '[{"title":"Synthetic label reference","url":"https://example.com/demo/labels"}]', '2026-07-10T09:03:00.000Z'),
  ('demo_contribution_pending_05', 'demo_challenge_steps_01', 'demo_session_11', 'Synthetic crossing note ready for Review.', 'This synthetic Contribution describes a fictional curb crossing and clearly states evidence limits.', '[{"title":"Synthetic crossing reference","url":"https://example.com/demo/crossing"}]', '2026-07-10T09:04:00.000Z'),
  ('demo_contribution_pending_06', 'demo_challenge_air_01', 'demo_session_12', 'Synthetic sensor comparison ready for Review.', 'This synthetic Contribution compares fictional sensor notes without claiming an environmental conclusion.', '[{"title":"Synthetic sensor reference","url":"https://example.com/demo/sensor"}]', '2026-07-10T09:05:00.000Z'),
  ('demo_contribution_pending_07', 'demo_challenge_archive_01', 'demo_session_01', 'Synthetic memory prompt ready for Review.', 'This synthetic Contribution frames a fictional public-memory prompt without requesting private information.', '[{"title":"Synthetic archive reference","url":"https://example.com/demo/archive"}]', '2026-07-10T09:06:00.000Z'),
  ('demo_contribution_pending_08', 'demo_challenge_food_01', 'demo_session_02', 'Synthetic pantry map ready for Review.', 'This synthetic Contribution maps a fictional shared pantry question with clear public boundaries.', '[{"title":"Synthetic pantry reference","url":"https://example.com/demo/pantry"}]', '2026-07-10T09:07:00.000Z'),
  ('demo_contribution_pending_09', 'demo_challenge_water_01', 'demo_session_03', 'Synthetic water-window comparison ready for Review.', 'This synthetic Contribution compares fictional water-window notes and preserves unresolved context.', '[{"title":"Synthetic water reference","url":"https://example.com/demo/water"}]', '2026-07-10T09:08:00.000Z'),
  ('demo_contribution_pending_10', 'demo_challenge_tools_01', 'demo_session_04', 'Synthetic repair-gap note ready for Review.', 'This synthetic Contribution records a fictional repair-knowledge gap for public review.', '[{"title":"Synthetic repair reference","url":"https://example.com/demo/repair"}]', '2026-07-10T09:09:00.000Z')
)
INSERT INTO contributions (id, challenge_id, session_id, summary, content, evidence_json, created_at)
SELECT id, challenge_id, session_id, summary, content, evidence_json, created_at
FROM pending_contributions
WHERE NOT EXISTS (
  SELECT 1 FROM contributions WHERE id = 'demo_contribution_pending_01'
);

-- Seventeen accepted Contributions become presentation-only Results when their
-- Challenges resolve. Three challenged Contributions preserve reopened history.
WITH settled_contributions (
  id, challenge_id, session_id, summary, content, evidence_json, created_at
) AS (VALUES
  ('demo_contribution_result_01', 'demo_challenge_tide_03', 'demo_session_07', 'Synthetic tide glossary accepted as a Result.', 'A synthetic public glossary with explicit uncertainty labels.', '[{"title":"Synthetic glossary reference","url":"https://example.com/demo/glossary"}]', '2026-07-11T09:00:00.000Z'),
  ('demo_contribution_result_02', 'demo_challenge_tide_04', 'demo_session_08', 'Synthetic cadence review accepted as a Result.', 'A synthetic cadence review with one transparent improvement.', '[{"title":"Synthetic cadence reference","url":"https://example.com/demo/cadence"}]', '2026-07-11T09:01:00.000Z'),
  ('demo_contribution_result_03', 'demo_challenge_tide_05', 'demo_session_09', 'Synthetic tide-note glossary accepted as a Result.', 'A synthetic public tide-note glossary with bounded terms.', '[{"title":"Synthetic glossary reference","url":"https://example.com/demo/tide-glossary"}]', '2026-07-11T09:02:00.000Z'),
  ('demo_contribution_result_04', 'demo_challenge_signal_03', 'demo_session_10', 'Synthetic listening walk accepted as a Result.', 'A synthetic listening-walk summary that keeps unknowns visible.', '[{"title":"Synthetic listening reference","url":"https://example.com/demo/listening"}]', '2026-07-11T09:03:00.000Z'),
  ('demo_contribution_result_05', 'demo_challenge_signal_04', 'demo_session_11', 'Synthetic signal question accepted as a Result.', 'A bounded fictional question for a public signal experiment.', '[{"title":"Synthetic question reference","url":"https://example.com/demo/question"}]', '2026-07-11T09:04:00.000Z'),
  ('demo_contribution_result_06', 'demo_challenge_steps_02', 'demo_session_12', 'Synthetic wayfinding comparison accepted as a Result.', 'A synthetic comparison of two fictional wayfinding prompts.', '[{"title":"Synthetic wayfinding reference","url":"https://example.com/demo/wayfinding"}]', '2026-07-11T09:05:00.000Z'),
  ('demo_contribution_result_07', 'demo_challenge_steps_03', 'demo_session_01', 'Synthetic step-count question accepted as a Result.', 'A synthetic unresolved step-count question with clear public framing.', '[{"title":"Synthetic steps reference","url":"https://example.com/demo/steps"}]', '2026-07-11T09:06:00.000Z'),
  ('demo_contribution_result_08', 'demo_challenge_air_02', 'demo_session_02', 'Synthetic calibration-gap explanation accepted as a Result.', 'A synthetic calibration-gap explanation without environmental claims.', '[{"title":"Synthetic calibration reference","url":"https://example.com/demo/calibration"}]', '2026-07-11T09:07:00.000Z'),
  ('demo_contribution_result_09', 'demo_challenge_air_03', 'demo_session_03', 'Synthetic measurement limits accepted as a Result.', 'A transparent synthetic list of low-cost measurement limits.', '[{"title":"Synthetic limits reference","url":"https://example.com/demo/limits"}]', '2026-07-11T09:08:00.000Z'),
  ('demo_contribution_result_10', 'demo_challenge_archive_02', 'demo_session_04', 'Synthetic archive tags accepted as a Result.', 'A synthetic archive-tag comparison with public provenance labels.', '[{"title":"Synthetic tags reference","url":"https://example.com/demo/tags"}]', '2026-07-11T09:09:00.000Z'),
  ('demo_contribution_result_11', 'demo_challenge_archive_03', 'demo_session_05', 'Synthetic source gap accepted as a Result.', 'A synthetic source-gap record for a fictional public-memory item.', '[{"title":"Synthetic source reference","url":"https://example.com/demo/source"}]', '2026-07-11T09:10:00.000Z'),
  ('demo_contribution_result_12', 'demo_challenge_food_02', 'demo_session_06', 'Synthetic meal-notice comparison accepted as a Result.', 'A synthetic comparison that preserves uncertainty about availability.', '[{"title":"Synthetic meal reference","url":"https://example.com/demo/meal"}]', '2026-07-11T09:11:00.000Z'),
  ('demo_contribution_result_13', 'demo_challenge_food_03', 'demo_session_07', 'Synthetic tool-share description accepted as a Result.', 'A synthetic tool-share workflow using only fictional information.', '[{"title":"Synthetic tool-share reference","url":"https://example.com/demo/tool-share"}]', '2026-07-11T09:12:00.000Z'),
  ('demo_contribution_result_14', 'demo_challenge_water_02', 'demo_session_08', 'Synthetic runoff question accepted as a Result.', 'A synthetic runoff question that avoids real-world condition claims.', '[{"title":"Synthetic runoff reference","url":"https://example.com/demo/runoff"}]', '2026-07-11T09:13:00.000Z'),
  ('demo_contribution_result_15', 'demo_challenge_water_03', 'demo_session_09', 'Synthetic observation template accepted as a Result.', 'A synthetic public observation template for visible water systems.', '[{"title":"Synthetic template reference","url":"https://example.com/demo/template"}]', '2026-07-11T09:14:00.000Z'),
  ('demo_contribution_result_16', 'demo_challenge_tools_02', 'demo_session_10', 'Synthetic repair-label comparison accepted as a Result.', 'A synthetic repair-label comparison that identifies ambiguity.', '[{"title":"Synthetic repair-label reference","url":"https://example.com/demo/repair-label"}]', '2026-07-11T09:15:00.000Z'),
  ('demo_contribution_result_17', 'demo_challenge_tools_03', 'demo_session_11', 'Synthetic maintenance review accepted as a Result.', 'A synthetic maintenance-note review with clear public limits.', '[{"title":"Synthetic maintenance reference","url":"https://example.com/demo/maintenance"}]', '2026-07-11T09:16:00.000Z'),
  ('demo_contribution_reopened_01', 'demo_challenge_tide_06', 'demo_session_12', 'Synthetic warning-sign comparison challenged for revision.', 'A synthetic warning-sign comparison intentionally retained as challenged public history.', '[{"title":"Synthetic warning reference","url":"https://example.com/demo/warning"}]', '2026-07-12T09:00:00.000Z'),
  ('demo_contribution_reopened_02', 'demo_challenge_steps_04', 'demo_session_01', 'Synthetic route note challenged for revision.', 'A synthetic route-note review intentionally retained as challenged public history.', '[{"title":"Synthetic route reference","url":"https://example.com/demo/route"}]', '2026-07-12T09:01:00.000Z'),
  ('demo_contribution_reopened_03', 'demo_challenge_air_04', 'demo_session_02', 'Synthetic sampling route challenged for revision.', 'A synthetic sampling-route note intentionally retained as challenged public history.', '[{"title":"Synthetic sampling reference","url":"https://example.com/demo/sampling"}]', '2026-07-12T09:02:00.000Z')
)
INSERT INTO contributions (id, challenge_id, session_id, summary, content, evidence_json, created_at)
SELECT id, challenge_id, session_id, summary, content, evidence_json, created_at
FROM settled_contributions
WHERE NOT EXISTS (
  SELECT 1 FROM contributions WHERE id = 'demo_contribution_result_01'
);

WITH demo_reviews (
  id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at
) AS (VALUES
  ('demo_review_support_01', 'demo_contribution_result_01', 'demo_session_01', 'support', 'The synthetic glossary is clear, bounded, and preserves uncertainty.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-01"}]', '2026-07-13T09:00:00.000Z'),
  ('demo_review_support_02', 'demo_contribution_result_02', 'demo_session_02', 'support', 'The synthetic cadence review is clear and the suggested improvement is public.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-02"}]', '2026-07-13T09:01:00.000Z'),
  ('demo_review_support_03', 'demo_contribution_result_03', 'demo_session_03', 'support', 'The synthetic glossary is concise and appropriately qualified.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-03"}]', '2026-07-13T09:02:00.000Z'),
  ('demo_review_support_04', 'demo_contribution_result_04', 'demo_session_04', 'support', 'The synthetic listening summary distinguishes observations from unknowns.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-04"}]', '2026-07-13T09:03:00.000Z'),
  ('demo_review_support_05', 'demo_contribution_result_05', 'demo_session_05', 'support', 'The fictional question is bounded and suitable for public work.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-05"}]', '2026-07-13T09:04:00.000Z'),
  ('demo_review_support_06', 'demo_contribution_result_06', 'demo_session_06', 'support', 'The comparison makes the fictional wayfinding tradeoff understandable.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-06"}]', '2026-07-13T09:05:00.000Z'),
  ('demo_review_support_07', 'demo_contribution_result_07', 'demo_session_07', 'support', 'The step-count question remains explicitly unresolved and public.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-07"}]', '2026-07-13T09:06:00.000Z'),
  ('demo_review_support_08', 'demo_contribution_result_08', 'demo_session_08', 'support', 'The calibration explanation makes no unsupported environmental claim.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-08"}]', '2026-07-13T09:07:00.000Z'),
  ('demo_review_support_09', 'demo_contribution_result_09', 'demo_session_09', 'support', 'The measurement limits are transparent and appropriately synthetic.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-09"}]', '2026-07-13T09:08:00.000Z'),
  ('demo_review_support_10', 'demo_contribution_result_10', 'demo_session_10', 'support', 'The archive tags make fictional provenance visible.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-10"}]', '2026-07-13T09:09:00.000Z'),
  ('demo_review_support_11', 'demo_contribution_result_11', 'demo_session_11', 'support', 'The source-gap record is bounded and clear about its limits.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-11"}]', '2026-07-13T09:10:00.000Z'),
  ('demo_review_support_12', 'demo_contribution_result_12', 'demo_session_12', 'support', 'The meal-notice comparison preserves the stated uncertainty.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-12"}]', '2026-07-13T09:11:00.000Z'),
  ('demo_review_support_13', 'demo_contribution_result_13', 'demo_session_01', 'support', 'The tool-share description is fictional, clear, and public.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-13"}]', '2026-07-13T09:12:00.000Z'),
  ('demo_review_support_14', 'demo_contribution_result_14', 'demo_session_02', 'support', 'The runoff question does not claim a real-world condition.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-14"}]', '2026-07-13T09:13:00.000Z'),
  ('demo_review_support_15', 'demo_contribution_result_15', 'demo_session_03', 'support', 'The observation template clearly separates source and inference.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-15"}]', '2026-07-13T09:14:00.000Z'),
  ('demo_review_support_16', 'demo_contribution_result_16', 'demo_session_04', 'support', 'The repair-label comparison exposes its ambiguity.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-16"}]', '2026-07-13T09:15:00.000Z'),
  ('demo_review_support_17', 'demo_contribution_result_17', 'demo_session_05', 'support', 'The maintenance review gives an appropriately bounded public result.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-17"}]', '2026-07-13T09:16:00.000Z'),
  ('demo_review_challenge_01', 'demo_contribution_reopened_01', 'demo_session_06', 'challenge', 'The fictional warning-sign comparison needs clearer source separation.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-18"}]', '2026-07-13T09:17:00.000Z'),
  ('demo_review_challenge_02', 'demo_contribution_reopened_02', 'demo_session_07', 'challenge', 'The fictional route note needs a more precise uncertainty statement.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-19"}]', '2026-07-13T09:18:00.000Z'),
  ('demo_review_challenge_03', 'demo_contribution_reopened_03', 'demo_session_08', 'challenge', 'The fictional sampling route needs clearer provenance.', '[{"title":"Synthetic review reference","url":"https://example.com/demo/review-20"}]', '2026-07-13T09:19:00.000Z')
)
INSERT INTO reviews (id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at)
SELECT id, contribution_id, reviewer_session_id, verdict, reason, evidence_json, created_at
FROM demo_reviews
WHERE NOT EXISTS (
  SELECT 1 FROM reviews WHERE id = 'demo_review_support_01'
);
