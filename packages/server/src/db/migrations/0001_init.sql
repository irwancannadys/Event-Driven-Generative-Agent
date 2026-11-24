-- 0001_init: initial schema.
-- See docs/schema.md for the reasoning behind every table.
-- Groups: reference (seeded), event log (source of truth),
-- projections (derived from events), operational (debugging and runtime settings).
-- All times are integer virtual seconds. All quantities are integers.

-- ===== Reference tables (seeded, not derived from events) =====

CREATE TABLE menu_items (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  price         INTEGER NOT NULL CHECK (price >= 0),
  cook_time_sec INTEGER NOT NULL CHECK (cook_time_sec > 0)
) STRICT;

CREATE TABLE ingredients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  unit          TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'pcs')),
  min_qty       INTEGER NOT NULL CHECK (min_qty >= 0),
  capacity_qty  INTEGER NOT NULL,
  lead_time_sec INTEGER NOT NULL CHECK (lead_time_sec > 0),
  CHECK (capacity_qty >= min_qty)
) STRICT;

CREATE TABLE recipe_items (
  menu_item_id    TEXT NOT NULL REFERENCES menu_items (id),
  ingredient_id   TEXT NOT NULL REFERENCES ingredients (id),
  qty_per_portion INTEGER NOT NULL CHECK (qty_per_portion > 0),
  PRIMARY KEY (menu_item_id, ingredient_id)
) STRICT;

CREATE TABLE regulars (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  usual_time_sec   INTEGER NOT NULL CHECK (usual_time_sec BETWEEN 0 AND 86399),
  favorite_table   INTEGER NOT NULL CHECK (favorite_table IN (1, 2, 3)),
  usual_order_json TEXT NOT NULL CHECK (json_valid(usual_order_json))
) STRICT;

CREATE TABLE suppliers_mock (
  ingredient_id       TEXT PRIMARY KEY REFERENCES ingredients (id),
  weight_on_time      INTEGER NOT NULL CHECK (weight_on_time >= 0),
  weight_late         INTEGER NOT NULL CHECK (weight_late >= 0),
  weight_out          INTEGER NOT NULL CHECK (weight_out >= 0),
  late_multiplier_pct INTEGER NOT NULL CHECK (late_multiplier_pct >= 100),
  CHECK (weight_on_time + weight_late + weight_out > 0)
) STRICT;

-- ===== Event log (append-only source of truth) =====

CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,
  sim_time     INTEGER NOT NULL CHECK (sim_time >= 0),
  actor        TEXT NOT NULL,
  origin       TEXT NOT NULL CHECK (origin IN
                 ('generator', 'scheduler', 'rule', 'llm', 'fallback', 'boss', 'system')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_events_sim_time ON events (sim_time, id);
CREATE INDEX idx_events_type ON events (type);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only: UPDATE is not allowed');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only: DELETE is not allowed');
END;

-- ===== Projections (derived from events, can be rebuilt by replay) =====

CREATE TABLE stock (
  ingredient_id TEXT PRIMARY KEY REFERENCES ingredients (id),
  qty           INTEGER NOT NULL CHECK (qty >= 0),
  low_flagged   INTEGER NOT NULL DEFAULT 0 CHECK (low_flagged IN (0, 1)),
  out_flagged   INTEGER NOT NULL DEFAULT 0 CHECK (out_flagged IN (0, 1))
) STRICT;

CREATE TABLE orders (
  id             INTEGER PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('placed', 'held', 'cooking', 'done')),
  source         TEXT NOT NULL CHECK (source IN ('walk_in', 'regular')),
  regular_id     TEXT REFERENCES regulars (id),
  table_id       INTEGER CHECK (table_id IN (1, 2, 3)),
  created_at_sim INTEGER NOT NULL,
  done_at_sim    INTEGER,
  CHECK (source <> 'regular' OR (regular_id IS NOT NULL AND table_id IS NOT NULL))
) STRICT;

CREATE TABLE order_items (
  order_id     INTEGER NOT NULL REFERENCES orders (id),
  menu_item_id TEXT NOT NULL REFERENCES menu_items (id),
  qty          INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, menu_item_id)
) STRICT;

CREATE TABLE agents (
  id      TEXT PRIMARY KEY CHECK (id IN ('cashier', 'cook', 'stock_admin', 'waiter')),
  role    TEXT NOT NULL,
  station TEXT NOT NULL CHECK (station IN
            ('cashier', 'kitchen', 'stock_shelf', 'boss_desk', 'table_1', 'table_2', 'table_3')),
  state   TEXT NOT NULL CHECK (state IN ('idle', 'walking', 'working', 'thinking'))
) STRICT;

CREATE TABLE agent_tasks (
  id               INTEGER PRIMARY KEY,
  agent_id         TEXT NOT NULL REFERENCES agents (id),
  kind             TEXT NOT NULL CHECK (kind IN ('goto', 'work')),
  params_json      TEXT NOT NULL CHECK (json_valid(params_json)),
  status           TEXT NOT NULL CHECK (status IN ('queued', 'active', 'done')),
  duration_sim_sec INTEGER NOT NULL CHECK (duration_sim_sec >= 0),
  started_at_sim   INTEGER,
  ends_at_sim      INTEGER
) STRICT;

CREATE INDEX idx_agent_tasks_agent ON agent_tasks (agent_id, status, id);

CREATE TABLE reports (
  id               INTEGER PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('restock', 'complaint')),
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('drafted', 'submitted', 'approved', 'rejected')),
  subject_json     TEXT NOT NULL CHECK (json_valid(subject_json)),
  created_at_sim   INTEGER NOT NULL,
  submitted_at_sim INTEGER,
  decided_at_sim   INTEGER
) STRICT;

CREATE TABLE restock_orders (
  id             INTEGER PRIMARY KEY,
  report_id      INTEGER NOT NULL REFERENCES reports (id),
  items_json     TEXT NOT NULL CHECK (json_valid(items_json)),
  supplier       TEXT NOT NULL CHECK (supplier IN ('on_time', 'late', 'out')),
  status         TEXT NOT NULL CHECK (status IN ('ordered', 'arrived', 'failed')),
  ordered_at_sim INTEGER NOT NULL,
  eta_sim        INTEGER,
  arrived_at_sim INTEGER
) STRICT;

CREATE TABLE complaints (
  id                     INTEGER PRIMARY KEY,
  order_id               INTEGER NOT NULL REFERENCES orders (id),
  cause                  TEXT NOT NULL CHECK (cause IN ('slow_service', 'wrong_order', 'quality')),
  status                 TEXT NOT NULL CHECK (status IN ('received', 'triaged', 'replied')),
  category               TEXT CHECK (category IN ('slow_service', 'wrong_order', 'quality', 'other')),
  severity               INTEGER CHECK (severity BETWEEN 1 AND 3),
  suggested_compensation TEXT CHECK (suggested_compensation IN ('none', 'discount_10', 'free_item')),
  report_id              INTEGER REFERENCES reports (id),
  final_compensation     TEXT CHECK (final_compensation IN ('none', 'discount_10', 'free_item')),
  received_at_sim        INTEGER NOT NULL,
  replied_at_sim         INTEGER
) STRICT;

CREATE TABLE regular_state (
  regular_id TEXT PRIMARY KEY REFERENCES regulars (id),
  visits     INTEGER NOT NULL CHECK (visits >= 0),
  present    INTEGER NOT NULL DEFAULT 0 CHECK (present IN (0, 1))
) STRICT;

CREATE TABLE cafe_tables (
  id              INTEGER PRIMARY KEY CHECK (id IN (1, 2, 3)),
  state           TEXT NOT NULL CHECK (state IN ('empty', 'prepared', 'occupied')),
  regular_id      TEXT REFERENCES regulars (id),
  last_tidied_sim INTEGER
) STRICT;

CREATE TABLE memories (
  id         INTEGER PRIMARY KEY,
  agent_id   TEXT NOT NULL CHECK (agent_id IN ('cashier', 'cook', 'stock_admin', 'waiter')),
  regular_id TEXT REFERENCES regulars (id),
  kind       TEXT NOT NULL CHECK (kind IN ('observation', 'reflection')),
  text       TEXT NOT NULL,
  sim_time   INTEGER NOT NULL
) STRICT;

-- ===== Operational (not derived from events) =====

CREATE TABLE llm_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose       TEXT NOT NULL CHECK (purpose IN
                  ('waiter_initiative', 'stock_proposal', 'complaint_triage', 'greeting', 'reflection')),
  input_summary TEXT NOT NULL,
  output_json   TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  valid         INTEGER NOT NULL CHECK (valid IN (0, 1)),
  latency_ms    INTEGER NOT NULL CHECK (latency_ms >= 0),
  model         TEXT NOT NULL,
  fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
  sim_time      INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- Single row. speed = virtual seconds per real second.
CREATE TABLE sim_clock (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  current_sim_sec INTEGER NOT NULL CHECK (current_sim_sec >= 0),
  speed           INTEGER NOT NULL CHECK (speed > 0),
  paused          INTEGER NOT NULL CHECK (paused IN (0, 1))
) STRICT;

INSERT INTO sim_clock (id, current_sim_sec, speed, paused) VALUES (1, 0, 60, 0);
