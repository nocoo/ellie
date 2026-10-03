ALTER TABLE users DROP COLUMN has_avatar;
ALTER TABLE users DROP COLUMN avatar;

CREATE INDEX idx_users_avatar_path ON users(avatar_path) WHERE avatar_path != '';
