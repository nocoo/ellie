-- Create messages table for private messaging (站内信)
-- Ref: docs/12-private-messages.md

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    sender_name TEXT NOT NULL,
    receiver_id INTEGER NOT NULL,
    receiver_name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    sender_deleted INTEGER NOT NULL DEFAULT 0,
    receiver_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, receiver_deleted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, sender_deleted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id, is_read, receiver_deleted);
