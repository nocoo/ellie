// @ellie/types — Shared type definitions for Ellie monorepo

// ─── Check-in (签到) ────────────────────────────────────────────
export type {
	CheckinHistoryEntry,
	CheckinLevel,
	CheckinMood,
	UserCheckin,
	UserCheckinSummary,
} from "./checkin";
export {
	CHECKIN_HOUR_END_EXCLUSIVE,
	CHECKIN_HOUR_START,
	CHECKIN_LEVELS,
	CHECKIN_MOODS,
	CHECKIN_REWARD_MAX,
	CHECKIN_REWARD_MIN,
	CHECKIN_TIMEZONE,
	getCheckinLevel,
} from "./checkin";
// ─── Email verification (docs/17 §5.4 — Rev4) ───────────────
export type {
	EmailNotVerifiedCtaVariant,
	EmailNotVerifiedDialog,
	EmailNotVerifiedPayload,
	EmailRequestCodeBody,
	EmailVerifyCodeBody,
} from "./email-verification";
export {
	cloneEmailNotVerifiedPayload,
	EMAIL_NOT_VERIFIED_PAYLOAD,
} from "./email-verification";
// ─── Forum ───────────────────────────────────────────────────
export type { ForumTreeNode, VisibilityContext } from "./forum";
export {
	buildForumTree,
	canViewForum as canViewForumVisibility,
	filterVisibleForums,
	findForumAncestors,
} from "./forum";
// ─── Pagination ──────────────────────────────────────────────
export type { CursorPayload } from "./pagination";
export {
	clampPageSize,
	DEFAULT_PAGE_SIZE,
	decodeCursor,
	decodeGenericCursor,
	encodeCursor,
	encodeGenericCursor,
	MAX_PAGE_SIZE,
} from "./pagination";
// ─── Permission ───────────────────────────────────────────────
export type {
	PermissionForum,
	PermissionPost,
	PermissionThread,
	PermissionUser,
} from "./permission";
export {
	canAccessAdmin,
	canCreateThread,
	canDeletePost,
	canDeleteThread,
	canEditPost,
	canEditThreadSubject,
	canManageThread,
	canManageUsers,
	canModerate,
	canMoveThread,
	canReplyToThread,
	canViewForum,
} from "./permission";
// ─── Post rating (评分) — docs/22 ──────────────────────────────
export type {
	CreatePostRatingRequest,
	CreatePostRatingResponse,
	PostRatingAggregate,
	PostRatingDimensionAggregate,
	PostRatingRow,
	PostRatingsResponse,
	RatingDimensionKey,
} from "./rating";
export {
	canRateDimension,
	canRevokeRating,
	EMPTY_RATING_AGGREGATE,
	getRatingPerDayCap,
	getRatingPerVoteBounds,
	RATING_DIMENSION_KEYS,
	RATING_LIMITS,
	RATING_QUOTA_WINDOW_SECONDS,
	RATING_REASON_MAX_LENGTH,
	RatingDimension,
	ratingDimensionToKey,
	ratingKeyToDimension,
} from "./rating";
// ─── Thread ──────────────────────────────────────────────────
export type { HighlightStyle, ThreadBadge, ThreadBadgeSource } from "./thread";
export { decodeHighlight, getThreadBadges } from "./thread";
// ─── Entity Interfaces ───────────────────────────────────────
export type {
	Attachment,
	CensorWord,
	Forum,
	ForumThreadType,
	ForumThreadTypeConfig,
	ForumVisibility,
	IpBan,
	Post,
	PostComment,
	PostThreadSummary,
	PublicUser,
	Thread,
	User,
	UserPostHistoryItem,
} from "./types";
// ─── Enums ───────────────────────────────────────────────────
export * from "./types";
// ─── User ────────────────────────────────────────────────────
export { isUserBanned, isUserMuted } from "./user";
// ─── Version ────────────────────────────────────────────────
export { VERSION, VERSION_DISPLAY } from "./version";
