// @ellie/types — Shared type definitions for Ellie monorepo

// ─── Enums ───────────────────────────────────────────────────
export * from "./types";

// ─── Entity Interfaces ───────────────────────────────────────
export type {
	User,
	Forum,
	Thread,
	Post,
	Attachment,
} from "./types";

// ─── Forum ───────────────────────────────────────────────────
export type { ForumTreeNode } from "./forum";
export { buildForumTree, filterVisibleForums } from "./forum";

// ─── Thread ──────────────────────────────────────────────────
export type { ThreadBadge, HighlightStyle } from "./thread";
export { getThreadBadges, decodeHighlight } from "./thread";

// ─── Pagination ──────────────────────────────────────────────
export type { CursorPayload } from "./pagination";
export {
	encodeCursor,
	decodeCursor,
	DEFAULT_PAGE_SIZE,
	MAX_PAGE_SIZE,
	clampPageSize,
} from "./pagination";

// ─── Permission ───────────────────────────────────────────────
export {
	canViewForum,
	canCreateThread,
	canReplyToThread,
	canModerate,
	canAccessAdmin,
	canManageUsers,
	canDeletePost,
} from "./permission";
