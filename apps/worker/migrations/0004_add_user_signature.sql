-- Add user signature (Discuz sightml) to users table
ALTER TABLE users ADD COLUMN signature TEXT NOT NULL DEFAULT '';
