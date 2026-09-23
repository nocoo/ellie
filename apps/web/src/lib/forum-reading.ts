/**
 * Server-only reading-contract integration (docs/29): bounded forum
 * summaries with per-render authorization gates, authoritative thread
 * counts, and the memory-runtime families they live in.
 *
 * Contract: packages/types/src/reading.ts (frozen). Invariants:
 *   - Every Worker call forwards the caller's JWT when present; no extra
 *     auth/me lookup happens here.
 *   - The reading bucket is the Worker-authorized structure meta.bucket;
 *     without it summary caching is skipped entirely — no role guessing.
 *   - Summaries cache per forum under bucket+forumId, bounded — never one
 *     arbitrary-size array, never a full Forum/User object. Beyond family
 *     capacity the runtime evicts; affected forums re-read, never vanish.
 *   - Cached candidates are re-verified per render with fresh gates
 *     (chunked so no forum is dropped): topicId/forumId/forumStatus===1/
 *     sticky>=0/anonymousAuthor===0/authorId equality. A state mismatch
 *     clears that forum's entry and re-reads once; anything still failing
 *     hides only the topic line, never the numeric summary.
 *   - Counts cache per (forumId, typeId, bucket) from an authorized bucket
 *     only; malformed totals throw instead of being cached as 0.
 */

import "server-only";

import {
	canViewForumVisibility,
	FORUM_SUMMARIES_PATH,
	FORUM_SUMMARY_GATES_PATH,
	type Forum,
	type ForumSummaryGate,
	type ForumSummaryTopic,
	type ForumVisibility,
	READING_AUTHOR_NAME_MAX,
	READING_SUBJECT_MAX,
	READING_TOPIC_GATE_MAX,
	type ReadingBucket,
	THREAD_COUNT_PATH,
	type ThreadCountData,
	UserRole,
} from "@ellie/types";
import { forumApi } from "./forum-api";
import { getMemoryRuntime } from "./memory-runtime";

// ---------------------------------------------------------------------------
// Bounding (before anything is cached)
// ---------------------------------------------------------------------------

const AVATAR_MAX = 2048;

/** Cut a display string without splitting a surrogate pair. */
function cutString(value: string, max: number): string {
	if (value.length <= max) return value;
	let end = max;
	while (end > 0) {
		const code = value.charCodeAt(end - 1);
		if (code >= 0xd800 && code <= 0xdbff) end -= 1;
		else break;
	}
	return value.slice(0, end);
}

/** URLs/paths are never truncated (corrupting them); oversized becomes "". */
function boundUrl(value: string): string {
	return typeof value === "string" && value.length <= AVATAR_MAX ? value : "";
}

function safeCount(value: number): number {
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function safeId(value: number): number {
	return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Bound one summary before it enters the runtime. Pure — exported for tests. */
export function boundForumSummaryTopic(summary: ForumSummaryTopic): ForumSummaryTopic {
	return {
		forumId: safeId(summary.forumId),
		threads: safeCount(summary.threads),
		posts: safeCount(summary.posts),
		todayThreads: safeCount(summary.todayThreads),
		topicId: safeId(summary.topicId),
		topicSubject: cutString(
			typeof summary.topicSubject === "string" ? summary.topicSubject : "",
			READING_SUBJECT_MAX,
		),
		topicCreatedAt: safeCount(summary.topicCreatedAt),
		authorId: safeId(summary.authorId),
		authorName: cutString(
			typeof summary.authorName === "string" ? summary.authorName : "",
			READING_AUTHOR_NAME_MAX,
		),
		authorAvatar: boundUrl(summary.authorAvatar),
		authorAvatarPath: boundUrl(summary.authorAvatarPath),
	};
}

// ---------------------------------------------------------------------------
// Gate checking (pure — exported for tests)
// ---------------------------------------------------------------------------

/**
 * Map a Worker reading bucket onto the authoritative forum visibility
 * context (`canViewForum` in @ellie/types owns the role mapping).
 */
export function visibilityContextForBucket(bucket: ReadingBucket) {
	switch (bucket) {
		case "anon":
			return { isLoggedIn: false, role: UserRole.User };
		case "member":
			return { isLoggedIn: true, role: UserRole.User };
		case "staff":
			return { isLoggedIn: true, role: UserRole.Mod };
		case "admin":
			return { isLoggedIn: true, role: UserRole.Admin };
	}
}

export function bucketAllowsVisibility(
	bucket: ReadingBucket,
	visibility: ForumVisibility,
): boolean {
	return canViewForumVisibility(visibility, visibilityContextForBucket(bucket));
}

/**
 * Current-state check for a cached summary candidate against its fresh gate:
 * the gate row must be for exactly this topic and forum, the forum must be
 * normally visible (status === 1), the topic not moderated-hidden
 * (sticky >= 0), not anonymous, and the author must be the author the
 * cached row claims. Viewer visibility is checked separately via
 * `bucketAllowsVisibility`.
 */
export function summaryCandidatePasses(
	gate: ForumSummaryGate,
	summary: ForumSummaryTopic,
): boolean {
	if (gate.topicId !== summary.topicId) return false;
	if (gate.forumId !== summary.forumId) return false;
	if (gate.forumStatus !== 1) return false;
	if (gate.sticky < 0) return false;
	if (gate.anonymousAuthor !== 0) return false;
	return gate.authorId === summary.authorId;
}

// ---------------------------------------------------------------------------
// Composition (pure — exported for tests)
// ---------------------------------------------------------------------------

const EMPTY_TOPIC_LINE: Pick<
	Forum,
	| "lastThreadId"
	| "lastPostAt"
	| "lastPoster"
	| "lastPosterId"
	| "lastPosterAvatar"
	| "lastPosterAvatarPath"
	| "lastThreadSubject"
> = {
	lastThreadId: 0,
	lastPostAt: 0,
	lastPoster: "",
	lastPosterId: 0,
	lastPosterAvatar: "",
	lastPosterAvatarPath: "",
	lastThreadSubject: "",
};

export interface ResolvedForumDisplay {
	forum: Forum;
	/** The candidate topic hidden by current gates (numeric summary only). */
	topicHidden: boolean;
}

/**
 * Compose the display Forum for one row: numeric summary always, topic line
 * only when a passing gate exists for the viewer bucket. Existing
 * lastThread* / lastPoster* / lastPostAt fields carry the topic author and
 * creation time (reading.ts contract), preserving the latest-reply UI.
 */
export function composeForumDisplay(args: {
	structure: Forum;
	summary: ForumSummaryTopic | undefined;
	gate: ForumSummaryGate | undefined;
	bucket: ReadingBucket;
}): ResolvedForumDisplay {
	const { structure, summary, gate, bucket } = args;
	// A forum without an eligible topic (topicId 0 — e.g. only anonymous
	// topics) still has valid counters; only the topic line hides.
	if (!summary || summary.forumId !== structure.id) {
		return {
			forum: { ...structure, threads: 0, posts: 0, todayThreads: 0, ...EMPTY_TOPIC_LINE },
			topicHidden: false,
		};
	}
	const numeric = {
		threads: summary.threads,
		posts: summary.posts,
		todayThreads: summary.todayThreads,
	};
	if (summary.topicId === 0) {
		return {
			forum: { ...structure, ...numeric, ...EMPTY_TOPIC_LINE },
			topicHidden: false,
		};
	}
	if (!gate || !summaryCandidatePasses(gate, summary)) {
		return {
			forum: { ...structure, ...numeric, ...EMPTY_TOPIC_LINE },
			topicHidden: true,
		};
	}
	if (!bucketAllowsVisibility(bucket, gate.visibility)) {
		return {
			forum: { ...structure, ...numeric, ...EMPTY_TOPIC_LINE },
			topicHidden: true,
		};
	}
	return {
		forum: {
			...structure,
			...numeric,
			lastThreadId: summary.topicId,
			lastThreadSubject: summary.topicSubject,
			lastPostAt: summary.topicCreatedAt,
			lastPoster: summary.authorName,
			lastPosterId: summary.authorId,
			lastPosterAvatar: summary.authorAvatar,
			lastPosterAvatarPath: summary.authorAvatarPath,
		},
		topicHidden: false,
	};
}

// ---------------------------------------------------------------------------
// Worker reads
// ---------------------------------------------------------------------------

export interface ForumSummariesResult {
	summaries: ForumSummaryTopic[];
	/** Fresh authorization rows for the displayed candidates. */
	gates: ForumSummaryGate[];
	/** Bucket the candidates were verified against. */
	bucket: ReadingBucket;
	/** Forums whose candidate failed current gates after one reselection pass. */
	hiddenTopicForumIds: number[];
}

/** Fetch the whole bounded summaries batch (one Worker call per request). */
async function fetchSummariesBatch(jwt: string | null): Promise<ForumSummaryTopic[]> {
	const { data } = jwt
		? await forumApi.getAuth<ForumSummaryTopic[]>(FORUM_SUMMARIES_PATH, jwt)
		: await forumApi.getAll<ForumSummaryTopic>(FORUM_SUMMARIES_PATH);
	return data.map(boundForumSummaryTopic);
}

export function forumSummaryKey(bucket: ReadingBucket, forumId: number): string {
	return `bucket:${bucket}:forum:${forumId}`;
}

/** Unique, positive, order-preserving topic ids worth gating. */
export function gateTopicIds(topicIds: number[]): number[] {
	const seen = new Set<number>();
	const ids: number[] = [];
	for (const id of topicIds) {
		if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

/**
 * Fresh authorization rows, chunked so every forum's candidate is checked —
 * a batch larger than READING_TOPIC_GATE_MAX is split, never truncated.
 * Never cached.
 */
export async function fetchSummaryGates(
	topicIds: number[],
	jwt: string | null,
): Promise<ForumSummaryGate[]> {
	const unique = gateTopicIds(topicIds);
	if (unique.length === 0) return [];
	const rows: ForumSummaryGate[] = [];
	for (let offset = 0; offset < unique.length; offset += READING_TOPIC_GATE_MAX) {
		const chunk = unique.slice(offset, offset + READING_TOPIC_GATE_MAX);
		const { data } = jwt
			? await forumApi.getAuth<ForumSummaryGate[]>(FORUM_SUMMARY_GATES_PATH, jwt, {
					topics: chunk.join(","),
				})
			: await forumApi.getAll<ForumSummaryGate>(FORUM_SUMMARY_GATES_PATH, {
					topics: chunk.join(","),
				});
		rows.push(...data);
	}
	return rows;
}

function passesForBucket(
	gate: ForumSummaryGate,
	summary: ForumSummaryTopic,
	bucket: ReadingBucket,
) {
	return summaryCandidatePasses(gate, summary) && bucketAllowsVisibility(bucket, gate.visibility);
}

/** Fail-closed gate retrieval: transport failure → no gates (topic lines hide). */
async function fetchSummaryGatesFailClosed(
	topicIds: number[],
	jwt: string | null,
): Promise<{ gates: ForumSummaryGate[]; failed: boolean }> {
	try {
		return { gates: await fetchSummaryGates(topicIds, jwt), failed: false };
	} catch {
		return { gates: [], failed: true };
	}
}

/**
 * Summaries for the forum list render.
 *
 * Each forum reads its own bounded `bucket+forumId` runtime entry; a
 * request-local batch promise is shared by every per-forum `load`, so a
 * fully cold render performs exactly one summaries Worker call and a warm
 * render performs none. Gates are always fetched fresh; a state mismatch
 * (delete/hide/move/anonymize/author change) clears the affected entries and
 * re-reads with one fresh batch, exactly once. `bucket === null` (no
 * Worker-authorized structure bucket) composes uncached — nothing is guessed
 * or cross-bucketed — and forums beyond family capacity simply re-read.
 */
export async function loadForumSummariesWithGates(args: {
	jwt: string | null;
	bucket: ReadingBucket | null;
	/** Forum ids the structure view will display. */
	forumIds: number[];
}): Promise<ForumSummariesResult> {
	const { jwt, bucket, forumIds } = args;
	const wanted = gateTopicIds(forumIds);

	// Lazy batch: created only when a per-forum runtime miss needs it — a
	// fully warm render performs no summaries Worker call. Reselection resets
	// it so the re-read uses a fresh batch.
	let batch: Promise<ForumSummaryTopic[]> | null = null;
	const ensureBatch = () => (batch ??= fetchSummariesBatch(jwt));
	const readEntries = async (): Promise<Map<number, ForumSummaryTopic>> => {
		if (bucket === null) {
			const rows = (await ensureBatch()).filter((summary) => wanted.includes(summary.forumId));
			return new Map(rows.map((summary) => [summary.forumId, summary]));
		}
		const runtime = getMemoryRuntime();
		const entries = new Map<number, ForumSummaryTopic>();
		for (let offset = 0; offset < wanted.length; offset += 32) {
			await Promise.all(
				wanted.slice(offset, offset + 32).map(async (forumId) => {
					const summary = await runtime.read(
						"forum-summary",
						forumSummaryKey(bucket, forumId),
						async () => {
							const rows = await ensureBatch();
							return rows.find((row) => row.forumId === forumId) ?? EMPTY_FORUM_SUMMARY(forumId);
						},
					);
					entries.set(forumId, summary);
				}),
			);
		}
		return entries;
	};

	let summaries = [...(await readEntries()).values()].filter(
		(summary) =>
			summary.forumId > 0 && (summary.topicId > 0 || summary.threads > 0 || summary.posts > 0),
	);
	// Gate retrieval fails closed: a transport failure yields no gates, so
	// every topic line hides while the structure and numeric summaries stay.
	// Stale gates are never used and reselection is skipped (it could not
	// distinguish transport failure from real mismatches).
	const gateResult = await fetchSummaryGatesFailClosed(
		gateTopicIds(summaries.map((s) => s.topicId)),
		jwt,
	);
	let gates = gateResult.gates;
	let gateByTopic = new Map(gates.map((gate) => [gate.topicId, gate]));

	const mismatched = gateResult.failed
		? []
		: summaries.filter((summary) => {
				if (summary.topicId === 0) return false;
				const gate = gateByTopic.get(summary.topicId);
				return !gate || !summaryCandidatePasses(gate, summary);
			});

	if (mismatched.length > 0 && bucket !== null) {
		const runtime = getMemoryRuntime();
		for (const summary of mismatched) {
			runtime.clear("forum-summary", forumSummaryKey(bucket, summary.forumId));
		}
		batch = null;
		summaries = [...(await readEntries()).values()].filter(
			(summary) =>
				summary.forumId > 0 && (summary.topicId > 0 || summary.threads > 0 || summary.posts > 0),
		);
		gates = (await fetchSummaryGatesFailClosed(gateTopicIds(summaries.map((s) => s.topicId)), jwt))
			.gates;
		gateByTopic = new Map(gates.map((gate) => [gate.topicId, gate]));
	}

	const hiddenTopicForumIds: number[] = [];
	for (const summary of summaries) {
		if (summary.topicId === 0) continue;
		const gate = gateByTopic.get(summary.topicId);
		if (!gate || !passesForBucket(gate, summary, bucket ?? "anon")) {
			hiddenTopicForumIds.push(summary.forumId);
		}
	}
	return {
		summaries,
		gates,
		bucket: bucket ?? "anon",
		hiddenTopicForumIds,
	};
}

/** Placeholder row for a forum the batch did not mention. */
function EMPTY_FORUM_SUMMARY(forumId: number): ForumSummaryTopic {
	return {
		forumId,
		threads: 0,
		posts: 0,
		todayThreads: 0,
		topicId: 0,
		topicSubject: "",
		topicCreatedAt: 0,
		authorId: 0,
		authorName: "",
		authorAvatar: "",
		authorAvatarPath: "",
	};
}

// ---------------------------------------------------------------------------
// Thread counts (cached per forumId + typeId + Worker-authorized bucket)
// ---------------------------------------------------------------------------

export function threadCountKey(forumId: number, typeId: number | null, bucket: ReadingBucket) {
	return `forum:${forumId}:type:${typeId ?? 0}:bucket:${bucket}`;
}

async function fetchThreadCount(
	forumId: number,
	typeId: number | null,
	jwt: string | null,
): Promise<number> {
	const searchParams = {
		forumId,
		...(typeId != null && typeId > 0 ? { typeId } : {}),
	};
	const { data } = jwt
		? await forumApi.getAuth<ThreadCountData>(THREAD_COUNT_PATH, jwt, searchParams)
		: await forumApi.get<ThreadCountData>(THREAD_COUNT_PATH, searchParams);
	if (!Number.isSafeInteger(data?.total) || data.total < 0) {
		throw new Error("Invalid thread count from Worker");
	}
	return data.total;
}

/**
 * Authoritative thread count for a list render. `bucket` must be the
 * Worker-authorized reading bucket from the structure response; `null`
 * bypasses the cache and reads the Worker directly instead of trusting an
 * unverified role.
 */
export async function loadThreadCount(
	forumId: number,
	typeId: number | null,
	bucket: ReadingBucket | null,
	jwt: string | null,
): Promise<number> {
	if (bucket === null) return fetchThreadCount(forumId, typeId, jwt);
	const runtime = getMemoryRuntime();
	return runtime.read("thread-count", threadCountKey(forumId, typeId, bucket), () =>
		fetchThreadCount(forumId, typeId, jwt),
	);
}
