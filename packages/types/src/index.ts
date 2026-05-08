// @ellie/types — Shared type definitions for Ellie monorepo

// ─── Version ────────────────────────────────────────────────
export { VERSION, VERSION_DISPLAY } from "./version";

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
	PostComment,
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
	encodeGenericCursor,
	decodeGenericCursor,
	DEFAULT_PAGE_SIZE,
	MAX_PAGE_SIZE,
	clampPageSize,
} from "./pagination";

// ─── User ────────────────────────────────────────────────────
export { isUserMuted, isUserBanned } from "./user";

// ─── Email verification (docs/17 §5.4 — Rev4) ───────────────
export type {
	EmailNotVerifiedCtaVariant,
	EmailNotVerifiedDialog,
	EmailNotVerifiedPayload,
	EmailRequestCodeBody,
	EmailVerifyCodeBody,
} from "./email-verification";
export {
	EMAIL_NOT_VERIFIED_PAYLOAD,
	cloneEmailNotVerifiedPayload,
} from "./email-verification";

// ─── Check-in (签到) ────────────────────────────────────────────
export type { UserCheckin, CheckinMood, CheckinLevel } from "./checkin";
export {
	CHECKIN_MOODS,
	CHECKIN_LEVELS,
	CHECKIN_REWARD_MIN,
	CHECKIN_REWARD_MAX,
	CHECKIN_HOUR_START,
	CHECKIN_HOUR_END,
	CHECKIN_TIMEZONE,
	getCheckinLevel,
} from "./checkin";

// ─── Permission ───────────────────────────────────────────────
export type {
	PermissionUser,
	PermissionForum,
	PermissionPost,
	PermissionThread,
} from "./permission";
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
