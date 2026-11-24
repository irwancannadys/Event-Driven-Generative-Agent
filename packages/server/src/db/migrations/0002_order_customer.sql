-- The customer behind a walk-in order (the id of its customer_arrived event) and the moment the cashier
-- had written the order down (decision 032). Both are projections of the event log, filled by applyEvent.
ALTER TABLE orders ADD COLUMN customer_id INTEGER;
ALTER TABLE orders ADD COLUMN recorded_at_sim INTEGER;
