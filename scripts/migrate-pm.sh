#!/bin/bash
# Export Discuz UCenter PM data for migration to D1
# Run on tongji.nocoo.cloud

# Export to CSV format that can be imported into D1
sudo mysql db_tongji_ucenter -N -e "
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
LEFT JOIN db_tongji_main.pre_common_member u1 ON p.msgfromid = u1.uid
LEFT JOIN db_tongji_main.pre_common_member u2 ON p.msgtoid = u2.uid
WHERE p.delstatus = 0
ORDER BY p.pmid
" | while IFS=$'\t' read -r pmid sender_id sender_name receiver_id receiver_name subject content is_read sender_deleted receiver_deleted created_at; do
    echo "INSERT INTO messages (id, sender_id, sender_name, receiver_id, receiver_name, subject, content, is_read, sender_deleted, receiver_deleted, created_at) VALUES ($pmid, $sender_id, \"$sender_name\", $receiver_id, \"$receiver_name\", \"$subject\", \"$content\", $is_read, $sender_deleted, $receiver_deleted, $created_at);"
done
