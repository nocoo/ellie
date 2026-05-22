#!/bin/bash
# Export Discuz UCenter PM data for migration to D1
#
# Required env vars:
#   MIGRATION_SSH_HOST     — VPS hostname to run MySQL export on
#   MIGRATION_SSH_USER     — SSH user (default: $USER)
#   MIGRATION_MYSQL_DB     — UCenter database (default: db_ucenter)
#   MIGRATION_MYSQL_MAIN_DB — Main Discuz database (default: db_main)
#
# Run this script ON the migration host, or set env vars and SSH in.

set -euo pipefail

: "${MIGRATION_SSH_HOST:?Set MIGRATION_SSH_HOST}"
SSH_USER="${MIGRATION_SSH_USER:-$USER}"
MYSQL_UC_DB="${MIGRATION_MYSQL_DB:-db_ucenter}"
MYSQL_MAIN_DB="${MIGRATION_MYSQL_MAIN_DB:-db_main}"

# Export to SQL INSERT format for D1
sudo mysql "$MYSQL_UC_DB" -N -e "
SELECT
    p.pmid,
    p.msgfromid as sender_id,
    COALESCE(u1.username, p.msgfrom, '') as sender_name,
    p.msgtoid as receiver_id,
    COALESCE(u2.username, '') as receiver_name,
    REPLACE(REPLACE(p.subject, '\"', '\\\\\"'), '\n', ' ') as subject,
    REPLACE(REPLACE(p.message, '\"', '\\\\\"'), '\n', '\\\\n') as content,
    CASE WHEN p.new = 0 THEN 1 ELSE 0 END as is_read,
    CASE WHEN p.folder = 'outbox' AND p.delstatus = 1 THEN 1 ELSE 0 END as sender_deleted,
    CASE WHEN p.folder = 'inbox' AND p.delstatus = 1 THEN 1 ELSE 0 END as receiver_deleted,
    p.dateline as created_at
FROM uc_pms p
LEFT JOIN ${MYSQL_MAIN_DB}.pre_common_member u1 ON p.msgfromid = u1.uid
LEFT JOIN ${MYSQL_MAIN_DB}.pre_common_member u2 ON p.msgtoid = u2.uid
WHERE p.delstatus = 0
ORDER BY p.pmid
" | while IFS=$'\t' read -r pmid sender_id sender_name receiver_id receiver_name subject content is_read sender_deleted receiver_deleted created_at; do
    echo "INSERT INTO messages (id, sender_id, sender_name, receiver_id, receiver_name, subject, content, is_read, sender_deleted, receiver_deleted, created_at) VALUES ($pmid, $sender_id, \"$sender_name\", $receiver_id, \"$receiver_name\", \"$subject\", \"$content\", $is_read, $sender_deleted, $receiver_deleted, $created_at);"
done
