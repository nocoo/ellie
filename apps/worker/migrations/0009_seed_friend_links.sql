-- Seed friend links navigation setting (empty array)
INSERT INTO settings (key, value, type)
VALUES ('general.navigation.friend_links', '[]', 'json')
ON CONFLICT (key) DO NOTHING;
