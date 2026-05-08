// D1 row mappers — convert snake_case D1 results to camelCase frontend types
// Each mapper explicitly selects and renames fields, preventing
// accidental exposure of sensitive or internal columns.

import type {
	Attachment,
	CensorWord,
	Forum,
	IpBan,
	Post,
	PublicUser,
	Thread,
	User,
} from "@ellie/types";

/** D1 row shape for users table */
interface D1UserRow {
	id: number;
	username: string;
	email: string;
	avatar: string;
	avatar_path: string;
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
	// Sensitive fields (never exposed): password_hash, password_salt
}

/** D1 row shape for forums table */
interface D1ForumRow {
	id: number;
	parent_id: number;
	name: string;
	description: string;
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
	// Internal field (never exposed):
	// post_table_id
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

/** Maps a D1 thread row to the frontend Thread type. Strips post_table_id. */
export function toThread(row: Record<string, unknown>): Thread {
	const r = row as unknown as D1ThreadRow;
	return {
		id: r.id,
		forumId: r.forum_id,
		authorId: r.author_id,
		authorName: r.author_name,
		authorAvatar: "", // Will be populated from KV cache
		authorAvatarPath: "", // Will be populated from KV cache
		subject: r.subject,
		createdAt: r.created_at,
		lastPostAt: r.last_post_at,
		lastPoster: r.last_poster,
		lastPosterId: r.last_poster_id ?? 0,
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
	};
}

/** Maps a D1 post row to the frontend Post type. Converts is_first INTEGER to boolean. */
export function toPost(row: Record<string, unknown>): Post {
	const r = row as unknown as D1PostRow;
	return {
		id: r.id,
		threadId: r.thread_id,
		forumId: r.forum_id,
		authorId: r.author_id,
		authorName: r.author_name,
		content: r.content,
		createdAt: r.created_at,
		isFirst: r.is_first === 1,
		position: r.position,
	};
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
