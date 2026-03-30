// @ellie/types — Shared type definitions for Ellie monorepo

// ─── Enums ───────────────────────────────────────────────────
export * from "./types";

// ─── Entity Interfaces ───────────────────────────────────────
export type {
	PublicUser,
	User,
	Forum,
	Thread,
	Post,
	Attachment,
	IpBan,
	CensorWord,
} from "./types";

// ─── Forum ───────────────────────────────────────────────────
export type { ForumTreeNode } from "./forum";
export { buildForumTree, filterVisibleForums, findForumAncestors } from "./forum";

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
