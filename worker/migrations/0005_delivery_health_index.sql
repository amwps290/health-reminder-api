CREATE INDEX idx_deliveries_success_time
ON notification_deliveries(success, attempted_at DESC);
