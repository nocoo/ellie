-- Migration: Set visibility for sensitive forums
-- Purpose: Hide staff-only forums from public view

-- 版务管理区 (id=8) and its active subforums -> staff only
UPDATE forums SET visibility = 'staff' WHERE id = 8;
UPDATE forums SET visibility = 'staff' WHERE parent_id = 8 AND status = 1;

-- 暂停版面区 (id=397) -> mark as paused (status=2)
-- This forum contains discontinued subforums that should not be visible
UPDATE forums SET status = 2 WHERE id = 397;
