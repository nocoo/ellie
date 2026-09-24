import "server-only";

import {
	boundMemoryCachePreview,
	FORUM_LIST_MAX_ENTRY_BYTES,
	FORUM_LIST_PAYLOAD_LIMIT_BYTES,
	MEMORY_CACHE_FAMILIES,
	MEMORY_CACHE_FAMILY_CAPACITY,
	MEMORY_CACHE_HISTORY_LIMIT,
	MEMORY_CACHE_PAYLOAD_LIMIT_BYTES,
	MEMORY_CACHE_TTL_MS,
	type MemoryCacheFamilyId,
	type MemoryCacheFamilyStats,
	type MemoryCacheHistorySample,
	type MemoryCacheOverview,
	type MemoryCacheQuery,
	observedAtInRange,
	parseStatisticsBatchResult,
	STATISTICS_BATCH_PATH,
	STATISTICS_WRITE_HEADER,
	type StatisticsBatchRequest,
	type StatisticsBatchResult,
	VERSION,
} from "@ellie/types";

const MAX_FLIGHTS = 64;
const MAX_VIEWS = 2048;
const MAX_USERS = 4096;
const ACTIVITY_INTERVAL = 15 * 60_000;
const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET = 8 * 3_600_000;
const PAYLOAD_RESERVED_BYTES = 1024 * 1024;
const HOME_DISPLAY_ENTRY_BYTES = 512 * 1024;
const DEFAULT_ENTRY_BYTES = 16 * 1024;
const THIRTY_MINUTES_MS = 30 * 60_000;

interface Entry {
	value: unknown;
	createdAt: number;
	expiresAt: number;
	bytes: number;
	preview: string;
}

interface Flight {
	valid: boolean;
	promise: Promise<unknown>;
}

export interface MemoryLoadToken {
	instanceId: string;
	family: MemoryCacheFamilyId;
	epoch: number;
	startedAt: number;
}

interface Family {
	epoch: number;
	entries: Map<string, Entry>;
	flights: Map<string, Flight>;
	stats: MemoryCacheFamilyStats;
}

interface Activity {
	observedAt: number;
	at: number;
	lastSuccess: number | null;
	dirty: boolean;
}

type Sender = (body: StatisticsBatchRequest, signal: AbortSignal) => Promise<StatisticsBatchResult>;

export async function readBoundedJson(
	source: { body: ReadableStream<Uint8Array> | null },
	maxBytes: number,
): Promise<unknown> {
	const reader = source.body?.getReader();
	if (!reader) throw new Error("Missing body");
	const decoder = new TextDecoder();
	let text = "";
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return JSON.parse(text + decoder.decode());
			size += value.byteLength;
			if (size > maxBytes) throw new Error("Body too large");
			text += decoder.decode(value, { stream: true });
		}
	} finally {
		void reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

async function sendBatch(
	body: StatisticsBatchRequest,
	signal: AbortSignal,
): Promise<StatisticsBatchResult> {
	const origin = process.env.WORKER_API_URL;
	const key = process.env.WEB_STATISTICS_WRITE_KEY;
	if (!origin || !key) throw new Error("Statistics writer is not configured");
	const response = await fetch(new URL(STATISTICS_BATCH_PATH, origin), {
		method: "POST",
		headers: { "Content-Type": "application/json", [STATISTICS_WRITE_HEADER]: key },
		body: JSON.stringify(body),
		cache: "no-store",
		redirect: "error",
		signal,
	});
	if (response.status !== 200) {
		void response.body?.cancel().catch(() => undefined);
		throw new Error("Unconfirmed statistics write");
	}
	const envelope = (await readBoundedJson(response, 131_072)) as { data?: unknown } | null;
	const parsed = parseStatisticsBatchResult(envelope);
	if (!parsed.ok) throw new Error("Invalid statistics accounting");
	return parsed.value;
}

function positiveId(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function iso(time: number | null): string | null {
	return time === null ? null : new Date(time).toISOString();
}

function safePreview(value: unknown): string {
	if (typeof value === "number") return String(value);
	if (!value || typeof value !== "object") return "";
	const source = value as Record<string, unknown>;
	if (
		Array.isArray(source.forums) &&
		Array.isArray(source.summaries) &&
		Array.isArray(source.digest)
	) {
		return JSON.stringify({
			forums: source.forums.length,
			summaries: source.summaries.length,
			digest: source.digest.length,
		});
	}
	const fields = [
		"total",
		"threads",
		"posts",
		"todayThreads",
		"forumId",
		"topicId",
		"todayPosts",
		"yesterdayPosts",
		"totalThreads",
		"totalPosts",
		"totalMembers",
		"totalOnline",
	];
	return JSON.stringify(
		Object.fromEntries(
			fields
				.filter((key) => typeof source[key] === "number" && Number.isFinite(source[key]))
				.map((key) => [key, source[key]]),
		),
	);
}

export class MemoryRuntime {
	readonly id = crypto.randomUUID();
	private readonly now: () => number;
	private readonly send: Sender;
	private readonly startedAt: number;
	private readonly families = new Map<MemoryCacheFamilyId, Family>();
	private readonly views = new Map<number, { increment: number; at: number }>();
	private readonly activities = new Map<number, Activity>();
	private readonly history: MemoryCacheHistorySample[] = [];
	private timer: ReturnType<typeof setInterval> | undefined;
	private flushPromise: Promise<void> | null = null;
	private trackedFlights = 0;
	private reservedViews = 0;
	private reservedActivities = 0;
	private detachedViews = 0;
	private detachedAt: number | null = null;
	private lastFlushAt: number | null = null;
	private lastSuccessAt: number | null = null;
	private unconfirmedViews = 0;
	private droppedViews = 0;
	private droppedActivities = 0;
	private lastScheduledFlush: number;

	constructor(options: { now?: () => number; send?: Sender } = {}) {
		this.now = options.now ?? Date.now;
		this.send = options.send ?? sendBatch;
		this.startedAt = this.now();
		this.lastScheduledFlush = this.startedAt;
		for (const id of MEMORY_CACHE_FAMILIES)
			this.families.set(id, {
				epoch: 0,
				entries: new Map(),
				flights: new Map(),
				stats: {
					id,
					entries: 0,
					maxEntries: MEMORY_CACHE_FAMILY_CAPACITY[id],
					hits: 0,
					misses: 0,
					evictions: 0,
					loadErrors: 0,
				},
			});
	}

	private payloadBytes(): number {
		let bytes =
			4096 +
			this.trackedFlights * 512 +
			(this.views.size + this.reservedViews) * 96 +
			this.activities.size * 128 +
			this.reservedActivities * 96 +
			this.history.length * 128;
		for (const family of this.families.values()) {
			for (const entry of family.entries.values()) bytes += entry.bytes;
		}
		return bytes;
	}

	private familyBytes(family: Family): number {
		let bytes = 0;
		for (const entry of family.entries.values()) bytes += entry.bytes;
		return bytes;
	}

	private prune(): void {
		const now = this.now();
		for (const family of this.families.values()) {
			for (const [key, entry] of family.entries)
				if (entry.expiresAt <= now) family.entries.delete(key);
		}
		if (this.reservedActivities > 0) return;
		for (const [id, item] of this.activities) {
			if (now - item.at >= DAY_MS || !observedAtInRange(item.observedAt, Math.floor(now / 1000))) {
				if (item.dirty) this.droppedActivities++;
				this.activities.delete(id);
			}
		}
	}

	capture(id: MemoryCacheFamilyId): MemoryLoadToken {
		const family = this.families.get(id);
		if (!family) throw new Error("Unknown memory cache family");
		return { instanceId: this.id, family: id, epoch: family.epoch, startedAt: this.now() };
	}

	peek<T>(id: MemoryCacheFamilyId, key: string): T | undefined {
		this.prune();
		const family = this.families.get(id);
		if (!family) throw new Error("Unknown memory cache family");
		const entry = family.entries.get(key);
		if (!entry) {
			family.stats.misses++;
			return undefined;
		}
		family.stats.hits++;
		family.entries.delete(key);
		family.entries.set(key, entry);
		return structuredClone(entry.value) as T;
	}

	admit<T>(key: string, value: T, token: MemoryLoadToken): boolean {
		const family = this.families.get(token.family);
		const now = this.now();
		const day = (at: number) => Math.floor((at + SHANGHAI_OFFSET) / DAY_MS);
		if (
			!family ||
			token.instanceId !== this.id ||
			token.epoch !== family.epoch ||
			key.length > 256 ||
			day(token.startedAt) !== day(now) ||
			(family.entries.get(key)?.createdAt ?? 0) > token.startedAt
		)
			return false;
		const isHomeDisplay = token.family === "home-display";
		const isForumList = token.family === "forum-list";
		const ttl = isHomeDisplay || isForumList ? THIRTY_MINUTES_MS : MEMORY_CACHE_TTL_MS;
		const expiresAt = Math.min(token.startedAt + ttl, (day(now) + 1) * DAY_MS - SHANGHAI_OFFSET);
		if (expiresAt <= now) return false;
		const encoded = JSON.stringify(value);
		const preview = boundMemoryCachePreview(safePreview(value));
		const bytes =
			encoded === undefined
				? Infinity
				: Buffer.byteLength(encoded) + Buffer.byteLength(preview) + key.length * 2 + 256;
		const entryLimit = isHomeDisplay
			? HOME_DISPLAY_ENTRY_BYTES
			: isForumList
				? FORUM_LIST_MAX_ENTRY_BYTES
				: DEFAULT_ENTRY_BYTES;
		if (bytes > entryLimit) return false;
		family.entries.delete(key);
		while (family.entries.size >= family.stats.maxEntries) this.evict(family);
		if (isForumList) {
			// Forum-list may only evict its own LRU, even at the global cap.
			while (
				this.familyBytes(family) + bytes > FORUM_LIST_PAYLOAD_LIMIT_BYTES ||
				this.payloadBytes() + bytes > MEMORY_CACHE_PAYLOAD_LIMIT_BYTES - PAYLOAD_RESERVED_BYTES
			) {
				if (family.entries.size === 0) return false;
				this.evict(family);
			}
		} else {
			while (
				this.payloadBytes() + bytes >
				MEMORY_CACHE_PAYLOAD_LIMIT_BYTES - PAYLOAD_RESERVED_BYTES
			) {
				const victim = [...this.families.values()].find((item) => item.entries.size > 0);
				if (!victim) break;
				this.evict(victim);
			}
		}
		family.entries.set(key, {
			value: structuredClone(value),
			createdAt: now,
			expiresAt,
			bytes,
			preview,
		});
		return true;
	}

	async runLoad<T>(id: MemoryCacheFamilyId, load: () => Promise<T>): Promise<T> {
		const family = this.families.get(id);
		if (!family) throw new Error("Unknown memory cache family");
		if (this.trackedFlights >= MAX_FLIGHTS) {
			family.stats.loadErrors++;
			throw new Error("Memory cache load capacity exceeded");
		}
		this.trackedFlights++;
		try {
			return await load();
		} catch (error) {
			family.stats.loadErrors++;
			throw error;
		} finally {
			this.trackedFlights--;
		}
	}

	async read<T>(id: MemoryCacheFamilyId, key: string, load: () => Promise<T>): Promise<T> {
		const family = this.families.get(id);
		if (!family) throw new Error("Unknown memory cache family");
		if (key.length > 256) {
			family.stats.loadErrors++;
			throw new Error("Memory cache key is too long");
		}
		this.prune();
		const hit = family.entries.get(key);
		if (hit) {
			family.stats.hits++;
			family.entries.delete(key);
			family.entries.set(key, hit);
			return structuredClone(hit.value) as T;
		}
		family.stats.misses++;
		const existing = family.flights.get(key);
		if (existing?.valid) return structuredClone(await existing.promise) as T;
		const token = this.capture(id);
		const flight: Flight = { valid: true, promise: Promise.resolve() };
		family.flights.set(key, flight);
		flight.promise = this.runLoad(id, async () => {
			const value = await load();
			if (flight.valid) this.admit(key, value, token);
			return value;
		}).finally(() => {
			if (family.flights.get(key) === flight) family.flights.delete(key);
		});
		return structuredClone(await flight.promise) as T;
	}

	private evict(family: Family): void {
		const key = family.entries.keys().next().value;
		if (key !== undefined) {
			family.entries.delete(key);
			family.stats.evictions++;
		}
	}

	clear(id?: MemoryCacheFamilyId, key?: string): void {
		for (const [familyId, family] of this.families) {
			if (id !== undefined && id !== familyId) continue;
			family.epoch++;
			if (key === undefined) {
				family.entries.clear();
				for (const flight of family.flights.values()) flight.valid = false;
				family.flights.clear();
			} else {
				family.entries.delete(key);
				const flight = family.flights.get(key);
				if (flight) flight.valid = false;
				family.flights.delete(key);
			}
		}
	}

	/**
	 * Invalidate every cached entry whose key starts with `prefix` inside the
	 * given family. Bumps the family epoch first so in-flight loads started
	 * before this call fail their epoch check at admission; other families
	 * and unrelated keys are untouched. The epoch bump happens even when no
	 * entry currently matches, so coordinators can rely on it to fence fills
	 * for keys that have not yet been admitted.
	 */
	clearPrefix(id: MemoryCacheFamilyId, prefix: string): void {
		const family = this.families.get(id);
		if (!family) return;
		family.epoch++;
		for (const key of family.entries.keys()) {
			if (key.startsWith(prefix)) family.entries.delete(key);
		}
		for (const [key, flight] of family.flights) {
			if (key.startsWith(prefix)) {
				flight.valid = false;
				family.flights.delete(key);
			}
		}
	}

	recordView(threadId: number): void {
		if (!positiveId(threadId)) return;
		const item = this.views.get(threadId);
		if (item && item.increment < 1000) {
			item.increment++;
			return;
		}
		if (item || this.views.size + this.reservedViews >= MAX_VIEWS) {
			this.droppedViews++;
			return;
		}
		this.views.set(threadId, { increment: 1, at: this.now() });
	}

	recordActivity(userId: number, observedAt = Math.floor(this.now() / 1000)): void {
		if (
			!positiveId(userId) ||
			!Number.isInteger(observedAt) ||
			!observedAtInRange(observedAt, Math.floor(this.now() / 1000))
		)
			return;
		const current = this.activities.get(userId);
		if (current) {
			if (observedAt > current.observedAt) {
				current.observedAt = observedAt;
				current.dirty = true;
				current.at = this.now();
			}
			return;
		}
		if (this.activities.size >= MAX_USERS) {
			if (this.reservedActivities > 0) {
				this.droppedActivities++;
				return;
			}
			const clean = [...this.activities].find(([, item]) => !item.dirty);
			if (clean) this.activities.delete(clean[0]);
			else {
				this.droppedActivities++;
				return;
			}
		}
		this.activities.set(userId, { observedAt, at: this.now(), lastSuccess: null, dirty: true });
	}

	flush(): Promise<void> {
		if (this.flushPromise) return this.flushPromise;
		this.flushPromise = Promise.resolve()
			.then(() => this.flushDetached())
			.finally(() => {
				this.flushPromise = null;
			});
		return this.flushPromise;
	}

	private async flushDetached(): Promise<void> {
		this.prune();
		const now = this.now();
		this.lastFlushAt = now;
		const views = [...this.views].map(([threadId, value]) => ({
			threadId,
			increment: value.increment,
		}));
		this.detachedAt = this.views.size
			? Math.min(...[...this.views.values()].map((item) => item.at))
			: null;
		this.reservedViews = views.length;
		this.detachedViews = views.reduce((sum, item) => sum + item.increment, 0);
		this.views.clear();
		const activities = [...this.activities]
			.filter(
				([, item]) =>
					item.dirty && (item.lastSuccess === null || now - item.lastSuccess >= ACTIVITY_INTERVAL),
			)
			.map(([userId, item]) => ({ userId, observedAt: item.observedAt }));
		this.reservedActivities = activities.length;
		const signal = AbortSignal.timeout(30_000);
		try {
			for (let offset = 0; offset < Math.max(views.length, activities.length); offset += 256) {
				const body = {
					views: views.slice(offset, offset + 256),
					activities: activities.slice(offset, offset + 256),
				};
				let result: StatisticsBatchResult | null = null;
				try {
					if (!signal.aborted) result = await this.send(body, signal);
					if (result && !matchesBatch(body, result)) result = null;
				} catch {
					result = null;
				}
				for (const [index, item] of body.views.entries()) {
					const status = result?.views[index].status ?? "unconfirmed";
					if (status === "unconfirmed") this.unconfirmedViews += item.increment;
					else if (status === "rejected") this.droppedViews += item.increment;
					else this.lastSuccessAt = this.now();
					this.detachedViews -= item.increment;
				}
				this.accountActivities(body, result);
				if (result?.activities.some((item) => item.status === "confirmed"))
					this.clear("site-stats");
			}
		} finally {
			this.reservedViews = 0;
			this.reservedActivities = 0;
			this.detachedViews = 0;
			this.detachedAt = null;
		}
	}

	private accountActivities(
		body: StatisticsBatchRequest,
		result: StatisticsBatchResult | null,
	): void {
		for (const [index, item] of body.activities.entries()) {
			const current = this.activities.get(item.userId);
			if (!current) continue;
			const status = result?.activities[index].status ?? "unconfirmed";
			if (status === "confirmed") {
				current.lastSuccess = this.now();
				this.lastSuccessAt = this.now();
			} else this.droppedActivities++;
			if (current.observedAt === item.observedAt) current.dirty = false;
		}
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.prune();
			const now = this.now();
			this.history.push({
				at: new Date(now).toISOString(),
				estimatedPayloadBytes: this.payloadBytes(),
				pendingViews: this.pendingViews(),
			});
			if (this.history.length > MEMORY_CACHE_HISTORY_LIMIT) this.history.shift();
			if (now - this.lastScheduledFlush >= MEMORY_CACHE_TTL_MS) {
				this.lastScheduledFlush = now;
				void this.flush();
			}
		}, 60_000);
		this.timer.unref();
	}

	stop(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}

	private pendingViews(): number {
		return (
			this.detachedViews + [...this.views.values()].reduce((sum, item) => sum + item.increment, 0)
		);
	}

	snapshot(query: MemoryCacheQuery): MemoryCacheOverview {
		this.prune();
		const now = this.now();
		const usage = process.memoryUsage();
		const entries = [...this.families]
			.filter(([id]) => !query.family || id === query.family)
			.flatMap(([family, state]) =>
				[...state.entries].map(([key, entry]) => ({
					family,
					key,
					createdAt: new Date(entry.createdAt).toISOString(),
					expiresAt: new Date(entry.expiresAt).toISOString(),
					estimatedBytes: entry.bytes,
					preview: entry.preview,
				})),
			);
		const dirtyActivities = [...this.activities.values()].filter((item) => item.dirty);
		const pendingAt = [...this.views.values()]
			.map((item) => item.at)
			.concat(dirtyActivities.map((item) => item.at));
		if (this.detachedAt !== null) pendingAt.push(this.detachedAt);
		return {
			instance: {
				id: this.id,
				version: VERSION,
				startedAt: new Date(this.startedAt).toISOString(),
				uptimeMs: Math.max(0, now - this.startedAt),
			},
			memory: {
				rssBytes: usage.rss,
				heapUsedBytes: usage.heapUsed,
				estimatedPayloadBytes: this.payloadBytes(),
				payloadLimitBytes: MEMORY_CACHE_PAYLOAD_LIMIT_BYTES,
			},
			families: [...this.families.values()].map((family) => ({
				...family.stats,
				entries: family.entries.size,
			})),
			entries: entries.slice((query.page - 1) * query.limit, query.page * query.limit),
			pagination: { page: query.page, limit: query.limit, total: entries.length },
			buffers: {
				pendingThreads: this.views.size + this.reservedViews,
				pendingViews: this.pendingViews(),
				pendingUsers: dirtyActivities.length,
				oldestPendingAt: pendingAt.length ? iso(Math.min(...pendingAt)) : null,
				flushing: this.flushPromise !== null,
				lastFlushAt: iso(this.lastFlushAt),
				lastSuccessAt: iso(this.lastSuccessAt),
				unconfirmedViews: this.unconfirmedViews,
				droppedViews: this.droppedViews,
				droppedActivities: this.droppedActivities,
			},
			history: this.history.map((sample) => ({ ...sample })),
		};
	}
}

function matchesBatch(body: StatisticsBatchRequest, result: StatisticsBatchResult): boolean {
	return (
		result.views.length === body.views.length &&
		result.activities.length === body.activities.length &&
		body.views.every(
			(item, i) =>
				item.threadId === result.views[i].threadId && item.increment === result.views[i].increment,
		) &&
		body.activities.every(
			(item, i) =>
				item.userId === result.activities[i].userId &&
				item.observedAt === result.activities[i].observedAt,
		)
	);
}

const processState = globalThis as typeof globalThis & { __ellieMemoryRuntime?: MemoryRuntime };

export function getMemoryRuntime(): MemoryRuntime {
	processState.__ellieMemoryRuntime ??= new MemoryRuntime();
	return processState.__ellieMemoryRuntime;
}
