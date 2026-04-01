-- Migration 0010: Add IP tracking fields to users
-- reg_ip: Registration IP address
-- last_ip: Last login IP address

ALTER TABLE users ADD COLUMN reg_ip TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN last_ip TEXT NOT NULL DEFAULT '';
