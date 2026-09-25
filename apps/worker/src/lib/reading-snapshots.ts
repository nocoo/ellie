import type { Forum, ForumListDisplay, ReadingBucket } from "@ellie/types";
import type { ThreadListMember } from "./cache/thread-list-read";
import type { Env } from "./env";

export const READING_CONFIG_TTL_MS = 24 * 60 * 60_000;
export const READING_RECOMMENDED_TTL_MS = 30 * 60_000;
export const READING_MEMBERSHIP_TTL_MS = 5 * 60_000;
export const READING_SNAPSHOT_MAX_BYTES = 192 * 1024;
export const READING_HOT_PAGES = 3;

export interface ReadingSnapshot<T> {
	createdAt: number;
	data: T;
}

export interface ReadingConfig {
	forums: Forum[];
	threadTypes: ForumListDisplay["threadTypes"];
}

export interface ReadingRecommendation {
	id: number;
	recommendedAt: number;
}

export interface ReadingAnnouncement extends ThreadListMember {
	forum_id: number;
}

export interface ReadingMembership {
	page: number;
	limit: number;
	typeId: number | null;
	window: ThreadListMember[];
	announcements: ReadingAnnouncement[];
}

export interface ForumReadSnapshot {
	forumId: number;
	bucket: ReadingBucket;
	config: ReadingSnapshot<ReadingConfig>;
	recommended: ReadingSnapshot<ReadingRecommendation[]>;
	page: ReadingSnapshot<ReadingMembership> | null;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, min = 0): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

export function isReadingConfig(value: unknown): value is ReadingConfig {
	if (!record(value) || !Array.isArray(value.forums) || value.forums.length > 2048) return false;
	const types = value.threadTypes;
	return (
		record(types) &&
		["enabled", "required", "listable", "prefix"].every((key) => typeof types[key] === "boolean") &&
		Array.isArray(types.types) &&
		types.types.length <= 256 &&
		types.types.every(
			(type) => record(type) && integer(type.id, 1) && typeof type.name === "string",
		) &&
		value.forums.every(
			(forum) =>
				record(forum) &&
				integer(forum.id, 1) &&
				integer(forum.parentId) &&
				typeof forum.name === "string" &&
				typeof forum.description === "string" &&
				typeof forum.announcement === "string" &&
				Array.isArray(forum.moderatorList),
		)
	);
}

export function isReadingRecommendations(value: unknown): value is ReadingRecommendation[] {
	return (
		Array.isArray(value) &&
		value.length <= 6 &&
		value.every((row) => record(row) && integer(row.id, 1) && integer(row.recommendedAt))
	);
}

function member(value: unknown): value is ThreadListMember {
	return (
		record(value) &&
		integer(value.id, 1) &&
		integer(value.sticky) &&
		value.sticky <= 3 &&
		integer(value.last_post_at)
	);
}

export function isReadingMembership(value: unknown): value is ReadingMembership {
	return (
		record(value) &&
		integer(value.page, 1) &&
		value.page <= READING_HOT_PAGES &&
		integer(value.limit, 1) &&
		value.limit <= 100 &&
		(value.typeId === null || integer(value.typeId, 1)) &&
		Array.isArray(value.window) &&
		value.window.length <= value.limit + 1 &&
		value.window.every(member) &&
		Array.isArray(value.announcements) &&
		value.announcements.length <= 512 &&
		value.announcements.every(
			(row) => member(row) && row.sticky === 2 && integer((row as ReadingAnnouncement).forum_id, 1),
		)
	);
}

export function validReadingSnapshot<T>(
	value: unknown,
	ttl: number,
	validate: (data: unknown) => data is T,
	now = Date.now(),
): value is ReadingSnapshot<T> {
	return (
		record(value) &&
		integer(value.createdAt) &&
		value.createdAt <= now &&
		now - value.createdAt < ttl &&
		validate(value.data)
	);
}

export async function restoreReadingSnapshot<T>(
	env: Env,
	key: string,
	ttl: number,
	validate: (data: unknown) => data is T,
	cached: unknown,
): Promise<ReadingSnapshot<T> | null> {
	if (validReadingSnapshot(cached, ttl, validate)) return cached;
	try {
		const text = await env.KV.get(key);
		if (!text || new TextEncoder().encode(text).byteLength > READING_SNAPSHOT_MAX_BYTES)
			return null;
		const value: unknown = JSON.parse(text);
		return validReadingSnapshot(value, ttl, validate) ? value : null;
	} catch {
		return null;
	}
}

export async function persistReadingSnapshot<T>(
	env: Env,
	key: string,
	ttl: number,
	data: T,
): Promise<ReadingSnapshot<T>> {
	const snapshot = { createdAt: Date.now(), data };
	const text = JSON.stringify(snapshot);
	if (new TextEncoder().encode(text).byteLength <= READING_SNAPSHOT_MAX_BYTES) {
		try {
			await env.KV.put(key, text, { expirationTtl: Math.ceil(ttl / 1000) });
		} catch {
			console.warn("[reading-snapshot] KV persistence unavailable");
		}
	}
	return snapshot;
}

async function signingKey(env: Env): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.JWT_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

export async function encodeForumReadSnapshot(
	env: Env,
	snapshot: ForumReadSnapshot,
): Promise<string | null> {
	const text = JSON.stringify(snapshot);
	const bytes = new TextEncoder().encode(`forum-read:v1:${text}`);
	if (new TextEncoder().encode(JSON.stringify(text)).byteLength + 65 > READING_SNAPSHOT_MAX_BYTES)
		return null;
	const signature = await crypto.subtle.sign("HMAC", await signingKey(env), bytes);
	const hex = [...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `${hex}:${text}`;
}

export async function decodeForumReadSnapshot(
	env: Env,
	token: string | null | undefined,
	forumId: number,
	bucket: ReadingBucket,
): Promise<ForumReadSnapshot | null> {
	if (
		!token ||
		new TextEncoder().encode(token).byteLength > READING_SNAPSHOT_MAX_BYTES ||
		!/^[a-f0-9]{64}:/.test(token)
	)
		return null;
	try {
		const text = token.slice(65);
		const signature = Uint8Array.from(token.slice(0, 64).match(/../g) ?? [], (pair) =>
			Number.parseInt(pair, 16),
		);
		if (
			!(await crypto.subtle.verify(
				"HMAC",
				await signingKey(env),
				signature,
				new TextEncoder().encode(`forum-read:v1:${text}`),
			))
		)
			return null;
		const value = JSON.parse(text) as ForumReadSnapshot;
		return record(value) && value.forumId === forumId && value.bucket === bucket ? value : null;
	} catch {
		return null;
	}
}

export async function invalidateReadingConfig(env: Env): Promise<void> {
	try {
		let cursor: string | undefined;
		const keys: string[] = [];
		for (let page = 0; page < 16; page++) {
			const result = await env.KV.list({ prefix: "reading:v1:config:", limit: 1000, cursor });
			keys.push(...result.keys.map((key) => key.name));
			if (result.list_complete) break;
			cursor = result.cursor;
		}
		for (let offset = 0; offset < keys.length; offset += 50) {
			await Promise.all(keys.slice(offset, offset + 50).map((key) => env.KV.delete(key)));
		}
	} catch {
		console.warn("[reading-snapshot] configuration invalidation failed");
	}
}

export async function invalidateReadingRecommendations(env: Env, forumId: number): Promise<void> {
	try {
		await env.KV.delete(`reading:v1:recommended:${forumId}`);
	} catch {
		console.warn("[reading-snapshot] recommendation invalidation failed");
	}
}
