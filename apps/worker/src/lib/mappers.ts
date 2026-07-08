// D1 row mappers — convert snake_case D1 results to camelCase frontend types
// Each mapper explicitly selects and renames fields, preventing
// accidental exposure of sensitive or internal columns.

import type {
	Attachment,
	CensorWord,
	Forum,
	IpBan,
	Post,
	PostRatingAggregate,
	PostThreadSummary,
	PublicUser,
	StickyLevel,
	Thread,
	User,
	UserCheckinSummary,
	UserPostHistoryItem,
} from "@ellie/types";
import { EMPTY_RATING_AGGREGATE, getCheckinLevel, UserRole } from "@ellie/types";

/**
 * Display name shown in place of the real author for anonymous posts (Discuz
 * convention). The same string is used by the legacy forum, so frontend
 * snapshots / search results stay consistent across the migration boundary.
 */
export const ANONYMOUS_AUTHOR_NAME = "匿名";

/**
 * Viewer context for serializers that need to decide whether to unmask
 * anonymous content. `null` represents an anonymous (logged-out) request.
 */
export interface ViewerContext {
	userId: number;
	role: number;
}

/** Staff (Mod / SuperMod / Admin) bypass anonymous masking. */
function isStaff(viewer: ViewerContext | null | undefined): boolean {
	if (!viewer) return false;
	const r = viewer.role;
	return r === UserRole.Admin || r === UserRole.SuperMod || r === UserRole.Mod;
}

/**
 * Decide whether the viewer is allowed to see the real author of a post that
 * was originally posted anonymously. Staff (Mod+) and the post's own author
 * always see the real identity; everyone else (anonymous visitors and other
 * logged-in members) sees the masked "匿名" label and authorId 0.
 */
export function shouldUnmaskAnonymous(
	authorId: number,
	viewer: ViewerContext | null | undefined,
): boolean {
	if (!viewer) return false;
	if (isStaff(viewer)) return true;
	return viewer.userId === authorId;
}

/** D1 row shape for users table */
interface D1UserRow {
	id: number;
	username: string;
	email: string;
	avatar: string;
	avatar_path: string;
	/**
	 * Legacy Discuz-era avatar flag. 1 iff the user uploaded an avatar under
	 * the old numeric-uid path scheme (pre-GUID). New uploads populate
	 * `avatar_path` instead. Read only — never mutated by app code.
	 */
	has_avatar?: number;
	status: number;
	role: number;
	reg_date: number;
	last_login: number;
	threads: number;
	posts: number;
	credits: number;
	coins: number;
	signature: string;
	group_title: string;
	group_stars: number;
	group_color: string;
	custom_title: string;
	digest_posts: number;
	ol_time: number;
	gender: number;
	birth_year: number;
	birth_month: number;
	birth_day: number;
	reside_province: string;
	reside_city: string;
	graduate_school: string;
	bio: string;
	interest: string;
	qq: string;
	site: string;
	last_activity: number;
	/** Campus affiliation (Discuz pre_common_member_profile.field1) */
	campus: string;
	// Check-in summary (LEFT JOIN user_checkins). Nullable when no row exists.
	checkin_total_days?: number | null;
	checkin_month_days?: number | null;
	checkin_streak_days?: number | null;
	checkin_last_checkin_at?: number | null;
	// Email verification (docs/17-email-verification.md §6.1)
	email_verified_at: number;
	email_normalized: string;
	email_changed_at: number;
	// IP fields (admin-only in public API, always in admin API)
	reg_ip?: string;
	last_ip?: string;
	// D4 tombstone columns
	purged_at?: number;
	purged_by?: number;
	// Admin list enrichment (virtual columns attached by enrichListRows;
	// absent on detail / non-admin queries).
	messages_count?: number;
	attachments_count?: number;
	// G.5: admin user-detail enrichment — `online:<uid>` KV soft signal,
	// only attached by the admin getById handler when KV has a fresh
	// (TTL-window) entry. Absent everywhere else.
	online_ip?: string;
	online_page?: string;
	online_ts?: number;
	// Sensitive fields (never exposed): password_hash, password_salt
}

/** D1 row shape for forums table */
interface D1ForumRow {
	id: number;
	parent_id: number;
	name: string;
	description: string;
	announcement: string;
	icon: string;
	display_order: number;
	threads: number;
	posts: number;
	type: string;
	status: number;
	visibility: string;
	moderators: string;
	moderator_ids: string;
	last_thread_id: number;
	last_post_at: number;
	last_poster: string;
	last_poster_id: number;
	last_thread_subject: string;
	/**
	 * Thread-category configuration switches (Doc forums.thread_types_*).
	 * Stored as INTEGER 0/1 in D1; toForum() projects to booleans on
	 * Forum.threadTypes (always present, see types ForumThreadTypeConfig).
	 * Optional on the row shape so a SELECT that omits these columns still
	 * type-checks; toForum() defaults missing values to 0.
	 */
	thread_types_enabled?: number;
	thread_types_required?: number;
	thread_types_listable?: number;
	thread_types_prefix?: number;
}

/** D1 row shape for threads table */
interface D1ThreadRow {
	id: number;
	forum_id: number;
	author_id: number;
	author_name: string;
	subject: string;
	created_at: number;
	last_post_at: number;
	last_poster: string;
	last_poster_id: number;
	replies: number;
	views: number;
	closed: number;
	sticky: number;
	digest: number;
	special: number;
	highlight: number;
	recommends: number;
	type_name: string;
	// Anonymous denormalized flags (migration 0048). Optional on the row
	// shape so internal SELECTs that don't project them still typecheck;
	// toThread() defaults missing values to 0 (= not anonymous).
	anonymous_author?: number;
	anonymous_last_poster?: number;
	// Internal field (never exposed):
	// post_table_id
	is_author_first_thread?: number;
	// Optional — only populated by `thread.getById`. Forum/profile/list
	// queries omit the EXISTS probe, in which case the mapper defaults
	// to `false`.
	is_recommended?: number;
}

/** D1 row shape for posts table */
interface D1PostRow {
	id: number;
	thread_id: number;
	forum_id: number;
	author_id: number;
	author_name: string;
	content: string;
	created_at: number;
	is_first: number; // INTEGER 0/1 in D1
	position: number;
	/**
	 * Anonymous posting flag (Discuz pre_forum_post.anonymous, restored by
	 * migration 0047). 0 = normal, 1 = anonymous; non-staff/non-author viewers
	 * see masked authorId/authorName.
	 */
	anonymous?: number;
}

/**
 * Build a `UserCheckinSummary` from LEFT-joined `user_checkins` columns.
 * Returns `null` when the user has no row (or `total_days = 0`).
 */
function toCheckinSummary(r: D1UserRow): UserCheckinSummary | null {
	const totalDays = r.checkin_total_days;
	if (totalDays == null || totalDays <= 0) {
		return null;
	}
	return {
		totalDays,
		monthDays: r.checkin_month_days ?? 0,
		streakDays: r.checkin_streak_days ?? 0,
		lastCheckinAt: r.checkin_last_checkin_at ?? 0,
		level: getCheckinLevel(totalDays),
	};
}

/**
 * Maps a D1 user row to the frontend User type.
 * Strips password_hash, password_salt and other sensitive fields.
 */
export function toUser(row: Record<string, unknown>): User {
	const r = row as unknown as D1UserRow;
	return {
		id: r.id,
		username: r.username,
		email: r.email,
		avatar: r.avatar,
		avatarPath: r.avatar_path ?? "",
		hasAvatar: r.has_avatar === 1,
		status: r.status,
		role: r.role,
		regDate: r.reg_date,
		lastLogin: r.last_login,
		threads: r.threads,
		posts: r.posts,
		credits: r.credits,
		coins: r.coins,
		signature: r.signature,
		groupTitle: r.group_title,
		groupStars: r.group_stars,
		groupColor: r.group_color,
		customTitle: r.custom_title,
		digestPosts: r.digest_posts,
		olTime: r.ol_time,
		gender: r.gender,
		birthYear: r.birth_year,
		birthMonth: r.birth_month,
		birthDay: r.birth_day,
		resideProvince: r.reside_province,
		resideCity: r.reside_city,
		graduateSchool: r.graduate_school,
		bio: r.bio,
		interest: r.interest,
		qq: r.qq,
		site: r.site,
		campus: r.campus ?? "",
		checkin: toCheckinSummary(r),
		lastActivity: r.last_activity,
		emailVerifiedAt: r.email_verified_at ?? 0,
		emailNormalized: r.email_normalized ?? "",
		emailChangedAt: r.email_changed_at ?? 0,
		regIp: r.reg_ip,
		lastIp: r.last_ip,
		purgedAt: r.purged_at ?? 0,
		purgedBy: r.purged_by ?? 0,
		// Only set when the row was enriched (admin list path); leave
		// undefined elsewhere so the field is absent in the JSON payload
		// rather than misleadingly `0`.
		...(r.messages_count !== undefined ? { messagesCount: r.messages_count } : {}),
		...(r.attachments_count !== undefined ? { attachmentsCount: r.attachments_count } : {}),
		// G.5: only emitted when admin getById attached a fresh online snapshot.
		...(r.online_ip !== undefined ? { onlineIp: r.online_ip } : {}),
		...(r.online_page !== undefined ? { onlinePage: r.online_page } : {}),
		...(r.online_ts !== undefined ? { onlineTs: r.online_ts } : {}),
	};
}

/** Maps a D1 forum row to the frontend Forum type. */
export function toForum(row: Record<string, unknown>): Forum {
	const r = row as unknown as D1ForumRow;
	return {
		id: r.id,
		parentId: r.parent_id,
		name: r.name,
		description: r.description,
		announcement: r.announcement ?? "",
		icon: r.icon,
		displayOrder: r.display_order,
		threads: r.threads,
		posts: r.posts,
		type: r.type as Forum["type"],
		status: r.status,
		visibility: (r.visibility || "public") as Forum["visibility"],
		moderators: r.moderators,
		moderatorList: [], // Will be populated from JOIN or separate query
		todayThreads: 0, // Computed at query time, not stored in D1
		lastThreadId: r.last_thread_id,
		lastPostAt: r.last_post_at,
		lastPoster: r.last_poster,
		lastPosterId: r.last_poster_id ?? 0,
		lastPosterAvatar: "", // Will be populated from KV cache
		lastPosterAvatarPath: "", // Will be populated from KV cache
		lastThreadSubject: r.last_thread_subject,
		threadTypes: {
			enabled: (r.thread_types_enabled ?? 0) === 1,
			required: (r.thread_types_required ?? 0) === 1,
			listable: (r.thread_types_listable ?? 0) === 1,
			prefix: (r.thread_types_prefix ?? 0) === 1,
		},
	};
}

/** Parse moderator_ids string (comma-separated) into number array */
export function parseModeratorIds(moderatorIds: string): number[] {
	if (!moderatorIds) return [];
	// Hand-rolled split-and-parse to avoid the
	// `.split().map().filter()` allocation chain. Behaviour matches the
	// previous implementation including whitespace tolerance and rejection
	// of NaN / non-positive ids.
	const out: number[] = [];
	const len = moderatorIds.length;
	let start = 0;
	for (let i = 0; i <= len; i++) {
		if (i === len || moderatorIds.charCodeAt(i) === 44 /* ',' */) {
			const n = Number.parseInt(moderatorIds.slice(start, i).trim(), 10);
			if (!Number.isNaN(n) && n > 0) out.push(n);
			start = i + 1;
		}
	}
	return out;
}

/** Maps a D1 thread row to the frontend Thread type. Strips post_table_id.
 *
 * `viewer` (optional) gates anonymous masking: when `row.anonymous_author === 1`
 * and the viewer is neither staff nor the original author, `authorId` is
 * zeroed and `authorName` becomes `ANONYMOUS_AUTHOR_NAME`. Same logic for
 * `lastPoster` / `lastPosterId` keyed on `anonymous_last_poster`. Both flags
 * are always projected so the frontend can render the "匿名" badge / hide the
 * profile link without an extra RPC.
 *
 * Callers that omit `viewer` (e.g. internal/admin reads) skip masking. */
export function toThread(row: Record<string, unknown>, viewer?: ViewerContext | null): Thread {
	const r = row as unknown as D1ThreadRow;
	const anonAuthor = r.anonymous_author === 1 ? 1 : 0;
	const anonLastPoster = r.anonymous_last_poster === 1 ? 1 : 0;
	const unmaskAuthor = anonAuthor === 0 || shouldUnmaskAnonymous(r.author_id, viewer);
	const unmaskLastPoster =
		anonLastPoster === 0 || shouldUnmaskAnonymous(r.last_poster_id ?? 0, viewer);
	return {
		id: r.id,
		forumId: r.forum_id,
		authorId: unmaskAuthor ? r.author_id : 0,
		authorName: unmaskAuthor ? r.author_name : ANONYMOUS_AUTHOR_NAME,
		authorAvatar: "", // Will be populated from KV cache
		authorAvatarPath: "", // Will be populated from KV cache
		subject: r.subject,
		createdAt: r.created_at,
		lastPostAt: r.last_post_at,
		lastPoster: unmaskLastPoster ? r.last_poster : ANONYMOUS_AUTHOR_NAME,
		lastPosterId: unmaskLastPoster ? (r.last_poster_id ?? 0) : 0,
		lastPosterAvatar: "", // Will be populated from KV cache
		lastPosterAvatarPath: "", // Will be populated from KV cache
		replies: r.replies,
		views: r.views,
		closed: r.closed,
		sticky: r.sticky,
		digest: r.digest,
		special: r.special,
		highlight: r.highlight,
		recommends: r.recommends,
		typeName: r.type_name,
		anonymousAuthor: anonAuthor,
		anonymousLastPoster: anonLastPoster,
		isAuthorFirstThread: r.is_author_first_thread === 1,
		isRecommended: r.is_recommended === 1,
	};
}

/** Maps a D1 post row to the frontend Post type. Converts is_first INTEGER to boolean.
 *
 * `ratingAggregate` (docs/22 §6.3) is attached by the caller — `post.list` and
 * `post.getById` each fetch the active-row aggregate(s) in a single batch
 * query alongside the main read. Defaults to the empty zero-state so the
 * field is never absent on the wire.
 *
 * `viewer` (optional) gates anonymous masking: when `row.anonymous === 1` and
 * the viewer is neither staff nor the post's author, `authorId` is zeroed and
 * `authorName` is replaced with `ANONYMOUS_AUTHOR_NAME`. The `anonymous` flag
 * itself is always projected so the frontend can render an "匿名" badge.
 * Callers that omit `viewer` (e.g. internal/admin paths that need the raw
 * row) skip masking entirely. */
export function toPost(
	row: Record<string, unknown>,
	ratingAggregate: PostRatingAggregate = EMPTY_RATING_AGGREGATE,
	viewer?: ViewerContext | null,
): Post {
	const r = row as unknown as D1PostRow;
	const anonymous = r.anonymous === 1 ? 1 : 0;
	const unmask = anonymous === 0 || shouldUnmaskAnonymous(r.author_id, viewer);
	return {
		id: r.id,
		threadId: r.thread_id,
		forumId: r.forum_id,
		authorId: unmask ? r.author_id : 0,
		authorName: unmask ? r.author_name : ANONYMOUS_AUTHOR_NAME,
		content: r.content,
		createdAt: r.created_at,
		isFirst: r.is_first === 1,
		position: r.position,
		ratingAggregate,
		anonymous,
	};
}

/**
 * Maps a D1 row that joins `posts` with `threads` (using explicit `thread_*`
 * aliases) to a `UserPostHistoryItem`.
 *
 * The SQL is expected to project `p.*` for post columns and the aliased
 * `t.id AS thread_id_for_link`, `t.subject AS thread_subject`, etc., so the
 * raw `p.*` fields are not overwritten by `t.*` of the same name.
 */
export function toUserPostHistoryItem(
	row: Record<string, unknown>,
	viewer?: ViewerContext | null,
): UserPostHistoryItem {
	const r = row as unknown as D1PostRow & D1ThreadJoinRow;
	const post = toPost(row, EMPTY_RATING_AGGREGATE, viewer);
	const thread: PostThreadSummary = {
		id: r.thread_id_for_link,
		forumId: r.thread_forum_id,
		subject: r.thread_subject,
		replies: r.thread_replies,
		views: r.thread_views,
		createdAt: r.thread_created_at,
		lastPostAt: r.thread_last_post_at,
		closed: r.thread_closed,
		sticky: r.thread_sticky as StickyLevel,
		digest: r.thread_digest,
		special: r.thread_special,
		highlight: r.thread_highlight,
		typeName: r.thread_type_name ?? "",
	};
	return { post, thread };
}

/** Row shape for the joined thread columns used by `toUserPostHistoryItem`. */
interface D1ThreadJoinRow {
	thread_id_for_link: number;
	thread_forum_id: number;
	thread_subject: string;
	thread_replies: number;
	thread_views: number;
	thread_created_at: number;
	thread_last_post_at: number;
	thread_closed: number;
	thread_sticky: number;
	thread_digest: number;
	thread_special: number;
	thread_highlight: number;
	thread_type_name: string | null;
}

/** D1 row shape for attachments table */
interface D1AttachmentRow {
	id: number;
	thread_id: number;
	post_id: number;
	author_id: number;
	filename: string;
	file_path: string;
	file_size: number;
	is_image: number; // INTEGER 0/1 in D1
	width: number;
	has_thumb: number; // INTEGER 0/1 in D1
	downloads: number;
	created_at: number;
}

/**
 * Sanitize attachment file path to prevent malicious URLs.
 * Only allows relative paths or paths from trusted CDN.
 * Returns empty string for dangerous/external URLs.
 */
function sanitizeFilePath(filePath: string): string {
	if (!filePath || !filePath.trim()) {
		return "";
	}

	const lowerPath = filePath.toLowerCase().trim();

	// Reject dangerous protocols
	if (
		lowerPath.startsWith("javascript:") ||
		lowerPath.startsWith("data:") ||
		lowerPath.startsWith("vbscript:") ||
		lowerPath.startsWith("file:")
	) {
		return "";
	}

	// Reject external URLs (http/https that aren't from our CDN)
	if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
		try {
			const url = new URL(filePath);
			// Only allow URLs from trusted CDN host
			if (url.host === "t.no.mt") {
				// Return just the path portion for consistency
				return url.pathname;
			}
		} catch {
			// Invalid URL
		}
		return "";
	}

	// Sanitize relative path: remove directory traversal attempts
	return filePath.replace(/\.\.\//g, "").replace(/^\/+/, "/");
}

/** Maps a D1 attachment row to the frontend Attachment type. Converts booleans. */
export function toAttachment(row: Record<string, unknown>): Attachment {
	const r = row as unknown as D1AttachmentRow;
	return {
		id: r.id,
		threadId: r.thread_id,
		postId: r.post_id,
		authorId: r.author_id,
		filename: r.filename,
		filePath: sanitizeFilePath(r.file_path),
		fileSize: r.file_size,
		isImage: r.is_image === 1,
		width: r.width,
		hasThumb: r.has_thumb === 1,
		downloads: r.downloads,
		createdAt: r.created_at,
	};
}

/** D1 row shape for ip_bans table */
interface D1IpBanRow {
	id: number;
	ip: string;
	admin_id: number;
	admin_name: string;
	reason: string;
	expires_at: number | null;
	created_at: number;
}

/** Maps a D1 ip_bans row to the frontend IpBan type. */
export function toIpBan(row: Record<string, unknown>): IpBan {
	const r = row as unknown as D1IpBanRow;
	return {
		id: r.id,
		ip: r.ip,
		adminId: r.admin_id,
		adminName: r.admin_name,
		reason: r.reason,
		expiresAt: r.expires_at,
		createdAt: r.created_at,
	};
}

/** D1 row shape for censor_words table */
interface D1CensorWordRow {
	id: number;
	find: string;
	replacement: string;
	action: "ban" | "replace";
	admin_id: number;
	admin_name: string;
	created_at: number;
}

/** Maps a D1 censor_words row to the frontend CensorWord type. */
export function toCensorWord(row: Record<string, unknown>): CensorWord {
	const r = row as unknown as D1CensorWordRow;
	return {
		id: r.id,
		find: r.find,
		replacement: r.replacement,
		action: r.action,
		adminId: r.admin_id,
		adminName: r.admin_name,
		createdAt: r.created_at,
	};
}

/**
 * Maps a D1 user row to PublicUser (no sensitive fields).
 * For public GET /api/v1/users/:id
 * @param row - D1 row data
 * @param includeIp - If true, include regIp/lastIp (admin-only)
 */
export function toPublicUser(row: Record<string, unknown>, includeIp = false): PublicUser {
	const r = row as unknown as D1UserRow;
	const result: PublicUser = {
		id: r.id,
		username: r.username,
		avatar: r.avatar,
		avatarPath: r.avatar_path ?? "",
		role: r.role,
		regDate: r.reg_date,
		threads: r.threads,
		posts: r.posts,
		credits: r.credits,
		coins: r.coins,
		signature: r.signature,
		groupTitle: r.group_title,
		groupStars: r.group_stars,
		groupColor: r.group_color,
		customTitle: r.custom_title,
		digestPosts: r.digest_posts,
		olTime: r.ol_time,
		lastActivity: r.last_activity,
		// Personal profile fields (public)
		gender: r.gender,
		birthYear: r.birth_year,
		birthMonth: r.birth_month,
		birthDay: r.birth_day,
		resideProvince: r.reside_province,
		resideCity: r.reside_city,
		graduateSchool: r.graduate_school,
		bio: r.bio,
		interest: r.interest,
		qq: r.qq,
		site: r.site,
		campus: r.campus ?? "",
		checkin: toCheckinSummary(r),
	};
	// Admin-only: include IP fields
	if (includeIp) {
		result.regIp = r.reg_ip;
		result.lastIp = r.last_ip;
	}
	return result;
}

// ─── User Cache Enhanced Mappers ──────────────────────────────────────────────
// These functions enrich Forum/Thread with user info from KV cache

import type { UserMiniProfile } from "./user-cache";

/**
 * Enrich forums with user info from KV cache.
 * Populates lastPosterAvatar from the user cache.
 */
export function enrichForumsWithUserCache(
	forums: Forum[],
	userCache: Map<number, UserMiniProfile>,
): Forum[] {
	return forums.map((forum) => {
		const user = userCache.get(forum.lastPosterId);
		if (user) {
			return {
				...forum,
				lastPoster: user.username, // Use cached username (may be updated)
				lastPosterAvatar: user.avatar,
				lastPosterAvatarPath: user.avatarPath,
			};
		}
		return forum;
	});
}

/**
 * Enrich threads with user info from KV cache.
 * Populates authorAvatar and lastPosterAvatar from the user cache.
 */
export function enrichThreadsWithUserCache(
	threads: Thread[],
	userCache: Map<number, UserMiniProfile>,
): Thread[] {
	return threads.map((thread) => {
		const author = userCache.get(thread.authorId);
		const lastPoster = userCache.get(thread.lastPosterId);
		return {
			...thread,
			authorName: author?.username ?? thread.authorName,
			authorAvatar: author?.avatar ?? "",
			authorAvatarPath: author?.avatarPath ?? "",
			lastPoster: lastPoster?.username ?? thread.lastPoster,
			lastPosterAvatar: lastPoster?.avatar ?? "",
			lastPosterAvatarPath: lastPoster?.avatarPath ?? "",
		};
	});
}
