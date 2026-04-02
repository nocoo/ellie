// @ellie/types — Shared type definitions for Ellie monorepo

// ─── Enums ───────────────────────────────────────────────────
export * from "./types";

// ─── Entity Interfaces ───────────────────────────────────────
export type {
	PublicUser,
	User,
	Forum,
	ForumVisibility,
	Thread,
	Post,
	Attachment,
	IpBan,
	CensorWord,
} from "./types";

// ─── Forum ───────────────────────────────────────────────────
export type { ForumTreeNode, VisibilityContext } from "./forum";
export {
	buildForumTree,
	filterVisibleForums,
	findForumAncestors,
	canViewForum as canViewForumVisibility,
} from "./forum";

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
	canEditPost,
	canDeletePost,
	canDeleteThread,
	canManageThread,
	canMoveThread,
} from "./permission";
