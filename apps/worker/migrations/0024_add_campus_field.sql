-- 0024_add_campus_field.sql — Add campus field to users table
-- Field1 in Discuz pre_common_member_profile stores user's campus
-- Values: 四平路校区, 嘉定校区, 校外人士, 其他校区, 沪北校区, 沪西校区

ALTER TABLE users ADD COLUMN campus TEXT NOT NULL DEFAULT '';
