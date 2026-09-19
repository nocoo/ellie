-- Preserve same-IP administration without scanning empty historical IP fields.
CREATE INDEX IF NOT EXISTS idx_users_reg_ip_nonempty ON users(reg_ip) WHERE reg_ip != '';
CREATE INDEX IF NOT EXISTS idx_users_last_ip_nonempty ON users(last_ip) WHERE last_ip != '';
PRAGMA optimize;
