-- Migration: Export Discuz UCenter PMs to D1 format
-- Run on tongji.nocoo.cloud MySQL, output to JSON file

-- First, let's see the data format (only non-deleted messages)
SELECT
    p.pmid as id,
    p.msgfromid as sender_id,
    COALESCE(u1.username, p.msgfrom, 'unknown') as sender_name,
    p.msgtoid as receiver_id,
    COALESCE(u2.username, 'unknown') as receiver_name,
    p.subject,
    p.message as content,
    CASE WHEN p.new = 0 THEN 1 ELSE 0 END as is_read,
    0 as sender_deleted,
    0 as receiver_deleted,
    p.dateline as created_at
FROM uc_pms p
LEFT JOIN db_tongji_main.pre_common_member u1 ON p.msgfromid = u1.uid
LEFT JOIN db_tongji_main.pre_common_member u2 ON p.msgtoid = u2.uid
WHERE p.delstatus = 0
ORDER BY p.pmid;
