CREATE TABLE forum_authority_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT NOT NULL
);
INSERT INTO forum_authority_revision VALUES (1, lower(hex(randomblob(16))));

CREATE TRIGGER forum_authority_insert AFTER INSERT ON forums
BEGIN
  UPDATE forum_authority_revision SET revision = lower(hex(randomblob(16))) WHERE id = 1;
END;

CREATE TRIGGER forum_authority_delete AFTER DELETE ON forums
BEGIN
  UPDATE forum_authority_revision SET revision = lower(hex(randomblob(16))) WHERE id = 1;
END;

CREATE TRIGGER forum_authority_update
AFTER UPDATE OF id, parent_id, status, visibility, type ON forums
WHEN OLD.id IS NOT NEW.id OR OLD.parent_id IS NOT NEW.parent_id
  OR OLD.status IS NOT NEW.status OR OLD.visibility IS NOT NEW.visibility
  OR OLD.type IS NOT NEW.type
BEGIN
  UPDATE forum_authority_revision SET revision = lower(hex(randomblob(16))) WHERE id = 1;
END;
