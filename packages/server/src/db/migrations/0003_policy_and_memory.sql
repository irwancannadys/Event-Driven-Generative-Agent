-- foreign_keys: off
-- Stage 5 (decision 034): the stock admin proposes changes of policy and keeps notes.
--  * stock_policy: the minimum stock that is in force for an ingredient when the boss approved another one
--    (a projection of the `policy_changed` events). No row means the value of the seed.
--  * memories.ingredient_id: which ingredient a note is about.
--  * reports.type may be 'policy'. SQLite cannot change a CHECK, so the table is built again (the flag on
--    the first line makes the runner switch foreign keys off for this migration and check them afterwards).

CREATE TABLE stock_policy (
  ingredient_id TEXT PRIMARY KEY REFERENCES ingredients (id),
  min_qty       INTEGER NOT NULL CHECK (min_qty >= 0)
) STRICT;

ALTER TABLE memories ADD COLUMN ingredient_id TEXT REFERENCES ingredients (id);

CREATE TABLE reports_new (
  id               INTEGER PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('restock', 'complaint', 'policy')),
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('drafted', 'submitted', 'approved', 'rejected')),
  subject_json     TEXT NOT NULL CHECK (json_valid(subject_json)),
  created_at_sim   INTEGER NOT NULL,
  submitted_at_sim INTEGER,
  decided_at_sim   INTEGER
) STRICT;

INSERT INTO reports_new (id, type, title, body, status, subject_json, created_at_sim, submitted_at_sim, decided_at_sim)
SELECT id, type, title, body, status, subject_json, created_at_sim, submitted_at_sim, decided_at_sim FROM reports;

DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
