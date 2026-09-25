import { HOME_DIGEST_LIMIT, type HomeRecentTopic } from "@ellie/types";
import type { Env } from "./env";

export const RECENT_ACTIVITY_KEY = "activity:recent:v1";
const DIRTY_PREFIX = "statistics:changed:v1:";
const DAY = 86_400;
const MAX_TOPICS = 512;
const memory = new WeakMap<KVNamespace, { topics: HomeRecentTopic[]; expiresAt: number }>();

function prune(topics: HomeRecentTopic[], now: number): HomeRecentTopic[] {
	return topics
		.filter((topic) => topic.lastPostAt > now - DAY && topic.lastPostAt <= now)
		.sort((a, b) => b.lastPostAt - a.lastPostAt || b.id - a.id)
		.slice(0, MAX_TOPICS);
}

function validTopic(value: unknown): value is HomeRecentTopic {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return (
		["id", "forumId", "lastPostAt"].every(
			(key) => Number.isSafeInteger(row[key]) && (row[key] as number) > 0,
		) &&
		Number.isSafeInteger(row.replies) &&
		(row.replies as number) >= 0 &&
		typeof row.subject === "string" &&
		row.subject.length <= 200 &&
		typeof row.forumName === "string" &&
		row.forumName.length <= 200
	);
}

export async function readRecentActivity(
	env: Env,
	now = Math.floor(Date.now() / 1000),
): Promise<HomeRecentTopic[]> {
	const cached = memory.get(env.KV);
	if (cached && cached.expiresAt > now) return prune(cached.topics, now);
	try {
		const raw = await env.KV.get<unknown>(RECENT_ACTIVITY_KEY, "json");
		const topics =
			Array.isArray(raw) && raw.length <= MAX_TOPICS && raw.every(validTopic)
				? prune(raw, now)
				: [];
		memory.set(env.KV, { topics, expiresAt: now + 300 });
		return topics;
	} catch {
		console.warn("[activity] snapshot read failed");
		return cached ? prune(cached.topics, now) : [];
	}
}

async function saveRecentActivity(env: Env, topics: HomeRecentTopic[], now: number): Promise<void> {
	const value = prune(topics.filter(validTopic), now);
	memory.set(env.KV, { topics: value, expiresAt: now + 300 });
	await env.KV.put(RECENT_ACTIVITY_KEY, JSON.stringify(value));
}

export async function recordRecentActivity(env: Env, topic: HomeRecentTopic): Promise<void> {
	try {
		if (!validTopic(topic)) return;
		const current = await readRecentActivity(env);
		await saveRecentActivity(
			env,
			[topic, ...current.filter((row) => row.id !== topic.id)],
			Math.floor(Date.now() / 1000),
		);
	} catch {
		console.warn("[activity] optimistic update failed");
	}
}

export async function markStatisticsForums(env: Env, forumIds: readonly number[]): Promise<void> {
	await Promise.all(
		[...new Set(forumIds)]
			.filter((id) => Number.isSafeInteger(id) && id >= 0)
			.map(async (id) => {
				try {
					await env.KV.put(`${DIRTY_PREFIX}${id}:${crypto.randomUUID()}`, "");
				} catch {
					console.warn("[statistics] changed forum marker failed");
				}
			}),
	);
}

export async function readChangedForums(env: Env): Promise<{ keys: string[]; forumIds: number[] }> {
	const keys: string[] = [];
	const forumIds = new Set<number>();
	let cursor: string | undefined;
	do {
		const page = await env.KV.list({ prefix: DIRTY_PREFIX, cursor });
		for (const key of page.keys) {
			const id = Number(key.name.slice(DIRTY_PREFIX.length).split(":")[0]);
			if (Number.isSafeInteger(id) && id >= 0) {
				keys.push(key.name);
				forumIds.add(id);
			}
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return { keys, forumIds: [...forumIds] };
}

export async function refreshRecentActivity(
	env: Env,
	now = Math.floor(Date.now() / 1000),
): Promise<number[]> {
	const result = await env.DB.prepare(`SELECT t.id, t.forum_id AS forumId, f.name AS forumName,
		t.subject, t.last_post_at AS lastPostAt, t.replies
		FROM threads t INDEXED BY idx_threads_latest JOIN forums f ON f.id = t.forum_id
		WHERE t.last_post_at > ? AND t.last_post_at <= ? AND t.sticky >= 0
		ORDER BY t.last_post_at DESC, t.id DESC`)
		.bind(now - DAY, now)
		.all<HomeRecentTopic>();
	if (!result.success) throw new Error("Recent activity refresh failed");
	const forumIds = [...new Set(result.results.map((row) => row.forumId))];
	const topics = result.results.map((row) => ({
		...row,
		subject: row.subject.slice(0, 200),
		forumName: row.forumName.slice(0, 200),
	}));
	await saveRecentActivity(env, topics, now);
	return forumIds;
}

export function selectRecentCandidates(
	topics: HomeRecentTopic[],
	allowed: ReadonlySet<number>,
): HomeRecentTopic[] {
	// Keep replacements available when fresh topic gates reject a cached candidate.
	return topics.filter((topic) => allowed.has(topic.forumId)).slice(0, HOME_DIGEST_LIMIT * 4);
}
