-- 0031_idx_attachments_author.sql — admin user list 4-count column
--
-- Admin users page (default 100/page) shows per-user counts: 主题, 帖子,
-- 站内信, 附件. The first two come from `users.threads` / `users.posts`
-- (denormalised). Messages count is fetched via post-page enrichment using
-- the existing `idx_messages_sender` / `idx_messages_receiver` indexes.
-- Attachments count is fetched via `attachments.author_id` IN (page-uid-set)
-- — this index makes that lookup an index range scan rather than a full
-- table scan per page.
--
-- Other consumers (admin attachment list `?author=…`, future moderator
-- audit views) also benefit from `author_id` selectivity.

CREATE INDEX IF NOT EXISTS idx_attachments_author ON attachments(author_id);
