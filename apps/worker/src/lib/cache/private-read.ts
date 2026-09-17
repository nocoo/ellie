import {
	type CacheDescriptor,
	encodeGenericCursor,
	type User,
	type UserCheckin,
} from "@ellie/types";
import type { Env } from "../env";
import { toUser } from "../mappers";
import { type ContentType, checkPostingPermission } from "../postingPermission";
import { getGen } from "./epoch";
import { dataCacheKey, pmUserGenKey } from "./keys";
import { type CacheGetOrSetOptions, cacheGetOrSet, cacheReadMany } from "./wrap";

export interface MessageRow {
	id: number;
	sender_id: number;
	sender_name: string;
	receiver_id: number;
	receiver_name: string;
	subject: string;
	content: string;
	is_read: number;
	sender_deleted: number;
	receiver_deleted: number;
	created_at: number;
}
export type MessageAccess = Pick<
	MessageRow,
	"id" | "sender_id" | "receiver_id" | "is_read" | "sender_deleted" | "receiver_deleted"
>;
interface MessagePage {
	items: { id: number; createdAt: number }[];
	nextCursor: string | null;
}
export interface PostingPreview {
	allowed: boolean;
	reason?: string;
	code?: string;
}
const MESSAGE_COLUMNS =
	"id, sender_id, sender_name, receiver_id, receiver_name, subject, content, is_read, sender_deleted, receiver_deleted, created_at";
export const SELF_USER_COLUMNS =
	"id, username, email, avatar, avatar_path, has_avatar, status, role, reg_date, last_login, threads, posts, credits, coins, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, campus, last_activity, email_verified_at, email_normalized, email_changed_at";
const FAMILIES = [
	"user:self",
	"user:checkin",
	"user:posting-preview",
	"pm:list",
	"pm:entity",
	"pm:unread",
];
const positive = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const selfFields = Object.keys(toUser({}));
export function isPrivateCacheData(d: CacheDescriptor, value: unknown): boolean {
	if (value === null) return ["user:self", "user:checkin", "pm:entity"].includes(d.family);
	if (!record(value)) return false;
	const only = (fields: string[]) => Object.keys(value).every((key) => fields.includes(key));
	if (d.family === "user:self")
		return (
			value.id === d.params.userId &&
			typeof value.username === "string" &&
			Number.isFinite(value.role) &&
			Number.isFinite(value.status) &&
			typeof value.hasAvatar === "boolean" &&
			only(selfFields)
		);
	if (d.family === "user:checkin")
		return (
			value.userId === d.params.userId &&
			["totalDays", "monthDays", "streakDays", "rewardTotal", "lastReward", "lastCheckinAt"].every(
				(key) => Number.isFinite(value[key]),
			) &&
			typeof value.mood === "string" &&
			typeof value.message === "string" &&
			only([
				"userId",
				"totalDays",
				"monthDays",
				"streakDays",
				"rewardTotal",
				"lastReward",
				"mood",
				"message",
				"lastCheckinAt",
			])
		);
	if (d.family === "user:posting-preview")
		return (
			typeof value.allowed === "boolean" &&
			(value.reason === undefined || typeof value.reason === "string") &&
			(value.code === undefined || typeof value.code === "string") &&
			only(["allowed", "reason", "code"])
		);
	if (d.family === "pm:unread")
		return Number.isSafeInteger(value.count) && Number(value.count) >= 0 && only(["count"]);
	if (d.family === "pm:list")
		return (
			only(["items", "nextCursor"]) &&
			(value.nextCursor === null || typeof value.nextCursor === "string") &&
			Array.isArray(value.items) &&
			value.items.length <= Number(d.params.limit) &&
			value.items.every(
				(row) =>
					record(row) &&
					positive(row.id) &&
					Number.isSafeInteger(row.createdAt) &&
					Number(row.createdAt) >= 0 &&
					Object.keys(row).every((key) => key === "id" || key === "createdAt"),
			)
		);
	return (
		d.family === "pm:entity" &&
		value.id === d.params.id &&
		positive(value.sender_id) &&
		positive(value.receiver_id) &&
		["sender_name", "receiver_name", "subject", "content"].every(
			(key) => typeof value[key] === "string",
		) &&
		["is_read", "sender_deleted", "receiver_deleted"].every(
			(key) => value[key] === 0 || value[key] === 1,
		) &&
		Number.isSafeInteger(value.created_at) &&
		Number(value.created_at) >= 0 &&
		only(MESSAGE_COLUMNS.split(", ")) &&
		mayReadMessage(value as unknown as MessageAccess, Number(d.params.userId))
	);
}
export function validatePrivateCacheDescriptor(d: CacheDescriptor): void {
	const p = d.params;
	if (!FAMILIES.includes(d.family) || !positive(p.userId) || d.scope !== `user:${p.userId}`)
		throw new TypeError("Invalid private cache scope");
	const fields =
		d.family === "pm:list"
			? ["userId", "box", "limit", "cursorTime", "cursorId"]
			: d.family === "pm:entity"
				? ["userId", "id"]
				: d.family === "user:posting-preview"
					? ["userId", "action"]
					: ["userId"];
	if (Object.keys(p).sort().join(",") !== fields.sort().join(","))
		throw new TypeError("Invalid private cache parameters");
	if (d.family === "pm:entity" && !positive(p.id)) throw new TypeError("Invalid message ID");
	if (
		d.family === "user:posting-preview" &&
		!["thread", "reply", "message"].includes(String(p.action))
	)
		throw new TypeError("Invalid posting action");
	if (d.family === "pm:list") {
		if (!["inbox", "outbox"].includes(String(p.box)) || !positive(p.limit) || p.limit > 100)
			throw new TypeError("Invalid mailbox page");
		if (
			p.cursorId !== null &&
			(!positive(p.cursorId) || !Number.isSafeInteger(p.cursorTime) || Number(p.cursorTime) < 0)
		)
			throw new TypeError("Invalid mailbox cursor");
		if ((p.cursorId === null) !== (p.cursorTime === null))
			throw new TypeError("Incomplete mailbox cursor");
	}
}
export async function privateCacheKey(env: Env, d: CacheDescriptor): Promise<string> {
	validatePrivateCacheDescriptor(d);
	if (d.family === "user:self" || d.family === "user:checkin")
		return `${d.family}:${d.params.userId}`;
	return dataCacheKey(
		d.family,
		d.params,
		d.scope,
		d.family.startsWith("pm:")
			? { mailbox: await getGen(env, pmUserGenKey(Number(d.params.userId))) }
			: {},
	);
}
export function mayReadMessage(row: MessageAccess | null | undefined, userId: number): boolean {
	if (!row || (row.sender_id !== userId && row.receiver_id !== userId)) return false;
	return (
		!(row.sender_id === userId && row.sender_deleted === 1) &&
		!(row.receiver_id === userId && row.receiver_deleted === 1)
	);
}
export async function loadMessageAccess(
	env: Env,
	ids: readonly number[],
): Promise<Map<number, MessageAccess>> {
	const rows = new Map<number, MessageAccess>();
	const unique = [...new Set(ids)];
	for (let start = 0; start < unique.length; start += 100) {
		const part = unique.slice(start, start + 100);
		const result = await env.DB.prepare(
			`SELECT id, sender_id, receiver_id, is_read, sender_deleted, receiver_deleted FROM messages WHERE id IN (${part.map(() => "?").join(",")})`,
		)
			.bind(...part)
			.all<MessageAccess>();
		if (!result.success) throw new Error("Current message ownership could not be loaded");
		for (const row of result.results) rows.set(row.id, row);
	}
	return rows;
}
async function loadMessageRows(
	env: Env,
	ids: readonly number[],
	userId: number,
): Promise<Map<number, MessageRow>> {
	const rows = new Map<number, MessageRow>();
	for (let start = 0; start < ids.length; start += 98) {
		const part = ids.slice(start, start + 98);
		const result = await env.DB.prepare(
			`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id IN (${part.map(() => "?").join(",")}) AND (sender_id = ? OR receiver_id = ?)`,
		)
			.bind(...part, userId, userId)
			.all<MessageRow>();
		if (!result.success) throw new Error("Message content could not be loaded");
		for (const row of result.results) if (mayReadMessage(row, userId)) rows.set(row.id, row);
	}
	return rows;
}
async function loadMessagePage(env: Env, d: CacheDescriptor): Promise<MessagePage> {
	const p = d.params;
	const inbox = p.box === "inbox";
	const cursor = p.cursorId !== null ? " AND (created_at, id) < (?, ?)" : "";
	const params =
		p.cursorId === null
			? [Number(p.userId)]
			: [Number(p.userId), Number(p.cursorTime), Number(p.cursorId)];
	const result = await env.DB.prepare(
		`SELECT id, created_at AS createdAt FROM messages WHERE ${inbox ? "receiver_id" : "sender_id"} = ? AND ${inbox ? "receiver_deleted" : "sender_deleted"} = 0${cursor} ORDER BY created_at DESC, id DESC LIMIT ?`,
	)
		.bind(...params, Number(p.limit) + 1)
		.all<{ id: number; createdAt: number }>();
	if (!result.success) throw new Error("Mailbox membership could not be loaded");
	const items = result.results.slice(0, Number(p.limit));
	const last = items.at(-1);
	return {
		items,
		nextCursor:
			last && result.results.length > Number(p.limit)
				? encodeGenericCursor({ createdAt: last.createdAt, id: last.id })
				: null,
	};
}
async function loadUnread(env: Env, userId: number): Promise<{ count: number }> {
	const row = await env.DB.prepare(
		"SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0 AND receiver_deleted = 0",
	)
		.bind(userId)
		.first<{ count: number }>();
	if (!row || !Number.isFinite(row.count)) throw new Error("Unread count was not returned");
	return row;
}
async function loadSelf(env: Env, userId: number): Promise<User | null> {
	const row = await env.DB.prepare(`SELECT ${SELF_USER_COLUMNS} FROM users WHERE id = ?`)
		.bind(userId)
		.first<Record<string, unknown>>();
	return row ? toUser(row) : null;
}
async function loadCheckin(env: Env, userId: number): Promise<UserCheckin | null> {
	const row = await env.DB.prepare(
		"SELECT user_id AS userId, total_days AS totalDays, month_days AS monthDays, streak_days AS streakDays, reward_total AS rewardTotal, last_reward AS lastReward, mood, message, last_checkin_at AS lastCheckinAt FROM user_checkins WHERE user_id = ?",
	)
		.bind(userId)
		.first<UserCheckin>();
	return row;
}
async function loadPostingPreview(
	env: Env,
	userId: number,
	action: ContentType,
): Promise<PostingPreview> {
	const row = await env.DB.prepare("SELECT email_verified_at, role FROM users WHERE id = ?")
		.bind(userId)
		.first<{ email_verified_at: number; role: number }>();
	if (!row) throw new Error("Posting user no longer exists");
	if (row.email_verified_at === 0)
		return { allowed: false, reason: "请先验证邮箱后再进行操作", code: "EMAIL_NOT_VERIFIED" };
	const result = await checkPostingPermission(env, { userId, role: row.role }, undefined, action);
	if (result.allowed) return { allowed: true };
	const body = (await result.error.json()) as {
		error: { code: string; message: string; details?: { message?: string; code?: string } };
	};
	return {
		allowed: false,
		reason: body.error.details?.message ?? body.error.message,
		code: body.error.details?.code ?? body.error.code,
	};
}
export async function rebuildPrivateCache(
	env: Env,
	_ctx: ExecutionContext | undefined,
	d: CacheDescriptor,
): Promise<unknown> {
	validatePrivateCacheDescriptor(d);
	const id = Number(d.params.userId);
	if (d.family === "pm:entity")
		return (await loadMessageRows(env, [Number(d.params.id)], id)).get(Number(d.params.id)) ?? null;
	if (d.family === "pm:list") return loadMessagePage(env, d);
	if (d.family === "pm:unread") return loadUnread(env, id);
	if (d.family === "user:self") return loadSelf(env, id);
	if (d.family === "user:checkin") return loadCheckin(env, id);
	return loadPostingPreview(env, id, d.params.action as ContentType);
}
export async function getPrivateData<T>(
	env: Env,
	ctx: ExecutionContext | undefined,
	d: CacheDescriptor,
): Promise<T> {
	return cacheGetOrSet(
		env,
		ctx,
		await privateCacheKey(env, d),
		() => rebuildPrivateCache(env, ctx, d) as Promise<T>,
		{ ...d, tier: "SHORT", validator: (value): value is T => isPrivateCacheData(d, value) },
	);
}
export async function getMessages(
	env: Env,
	ctx: ExecutionContext | undefined,
	userId: number,
	ids: number[],
): Promise<Map<number, MessageRow>> {
	const entries = await Promise.all(
		[...new Set(ids)].map(async (id) => {
			const d = { family: "pm:entity", scope: `user:${userId}`, params: { userId, id } };
			const key = await privateCacheKey(env, d);
			const options: CacheGetOrSetOptions<MessageRow | null> = {
				...d,
				tier: "SHORT",
				validator: (value: unknown): value is MessageRow | null => isPrivateCacheData(d, value),
			};
			return { id, d, key, options };
		}),
	);
	const configs = new Map(entries.map((entry) => [entry.key, entry.options]));
	const hits = await cacheReadMany<MessageRow | null>(
		env,
		entries.map((entry) => entry.key),
		(key) =>
			configs.get(key) ?? {
				family: "pm:entity",
				tier: "SHORT",
				scope: `user:${userId}`,
				params: { userId },
			},
	);
	const misses = entries.filter((entry) => !hits.has(entry.key));
	let task: Promise<Map<number, MessageRow>> | undefined;
	await Promise.all(
		misses.map(async (entry) => {
			const row = await cacheGetOrSet(
				env,
				ctx,
				entry.key,
				async () => {
					task ??= loadMessageRows(
						env,
						misses.map((e) => e.id),
						userId,
					);
					return (await task).get(entry.id) ?? null;
				},
				entry.options,
			);
			hits.set(entry.key, row);
		}),
	);
	const result = new Map<number, MessageRow>();
	for (const entry of entries) {
		const row = hits.get(entry.key);
		if (row) result.set(entry.id, row);
	}
	return result;
}
export function getMailbox(
	env: Env,
	ctx: ExecutionContext | undefined,
	d: CacheDescriptor,
): Promise<MessagePage> {
	return getPrivateData(env, ctx, d);
}
export function getUnreadCount(
	env: Env,
	ctx: ExecutionContext | undefined,
	userId: number,
): Promise<{ count: number }> {
	return getPrivateData(env, ctx, {
		family: "pm:unread",
		params: { userId },
		scope: `user:${userId}`,
	});
}
