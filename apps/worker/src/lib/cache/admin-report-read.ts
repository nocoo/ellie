import type {
	CacheDescriptor,
	CacheParams,
	CacheTier,
	CheckinHistoryEntry,
	UserCheckin,
} from "@ellie/types";
import { todayVisitsMemory } from "../analytics/flushSink-memory";
import type { PathKind } from "../analytics/types";
import type { Env } from "../env";
import { isValidShanghaiDateLocal } from "../shanghaiTime";
import { getGen } from "./epoch";
import { dataCacheKey, statsReportsGenKey } from "./keys";
import { cacheGetOrSet } from "./wrap";
export const LIST_PAGE_SIZE_MAX = 100;
export const LIST_PAGE_SIZE_DEFAULT = 20;
export const FORUM_DIST_LIMIT = 50;
export const MAX_HISTORY_ROWS = 1000;
export const ALLOWED_RANGES = ["7d", "30d", "90d"] as const;
export const ALLOWED_METRICS = ["users", "threads", "posts", "checkins"] as const;
export const PATH_KIND_VALUES: ReadonlySet<PathKind> = new Set<PathKind>([
	"thread",
	"forum",
	"user",
	"home",
	"digest",
	"search",
	"checkin",
	"messages",
	"auth_page",
	"other",
]);

const OFFSET = 8 * 3600;
const DAY = 86_400;
const REPORT_JOIN_COLUMNS = `
	r.id, r.type, r.target_id, r.reporter_id, r.reporter_name,
	r.reason, r.status, r.handler_id, r.handler_name, r.handled_at, r.created_at,
	CASE WHEN r.type = 'post' THEN p.thread_id WHEN r.type = 'thread' THEN t.id ELSE NULL END AS thread_id,
	CASE WHEN r.type = 'post' THEN tp.subject WHEN r.type = 'thread' THEN t.subject ELSE NULL END AS target_title,
	CASE WHEN r.type = 'user' THEN u.username ELSE NULL END AS target_name
`
	.replace(/\s+/g, " ")
	.trim();
const REPORT_JOIN_FROM = `
	FROM reports r
	LEFT JOIN posts p ON r.type = 'post' AND r.target_id = p.id
	LEFT JOIN threads tp ON r.type = 'post' AND p.thread_id = tp.id
	LEFT JOIN threads t ON r.type = 'thread' AND r.target_id = t.id
	LEFT JOIN users u ON r.type = 'user' AND r.target_id = u.id
`
	.replace(/\s+/g, " ")
	.trim();
const ADMIN_LOG_COLUMNS =
	"id, admin_id, admin_name, action, target_type, target_id, details, ip, created_at";

type Range = (typeof ALLOWED_RANGES)[number];
type TrendMetric = (typeof ALLOWED_METRICS)[number];
type Spec = { family: "admin:display" | "admin:analytics"; tier: CacheTier; keys: string[] };

const SPECS: Record<string, Spec> = {
	"reports:list": {
		family: "admin:display",
		tier: "SHORT",
		keys: ["resource", "operation", "status", "type", "reporterId", "page", "limit"],
	},
	"reports:detail": {
		family: "admin:display",
		tier: "SHORT",
		keys: ["resource", "operation", "id"],
	},
	"analytics:overview": {
		family: "admin:analytics",
		tier: "MEDIUM",
		keys: ["resource", "operation", "date"],
	},
	"analytics:trend": {
		family: "admin:analytics",
		tier: "MEDIUM",
		keys: ["resource", "operation", "date", "metric", "range"],
	},
	"analytics:forum-dist": {
		family: "admin:analytics",
		tier: "MEDIUM",
		keys: ["resource", "operation", "date", "range"],
	},
	"analytics:checkin-trend": {
		family: "admin:analytics",
		tier: "MEDIUM",
		keys: ["resource", "operation", "date", "range"],
	},
	"logins:kpi": {
		family: "admin:analytics",
		tier: "MEDIUM",
		keys: ["resource", "operation", "date"],
	},
	"logins:list": {
		family: "admin:display",
		tier: "SHORT",
		keys: ["resource", "operation", "date", "ok", "kind", "errorCode", "page", "limit"],
	},
	"visits:kpi": {
		family: "admin:analytics",
		tier: "MEDIUM",
		keys: ["resource", "operation", "date"],
	},
	"visits:list": {
		family: "admin:analytics",
		tier: "MEDIUM",
		keys: ["resource", "operation", "date", "pathKind", "page", "limit"],
	},
	"checkins:user": {
		family: "admin:display",
		tier: "SHORT",
		keys: ["resource", "operation", "userId", "from", "to"],
	},
	"stats:totals": {
		family: "admin:analytics",
		tier: "MEDIUM",
		keys: ["resource", "operation"],
	},
	"admin-logs:list": {
		family: "admin:display",
		tier: "SHORT",
		keys: [
			"resource",
			"operation",
			"adminId",
			"action",
			"targetType",
			"targetId",
			"startDate",
			"endDate",
			"page",
			"limit",
		],
	},
};

function op(d: CacheDescriptor): string {
	return `${d.params.resource}:${d.params.operation}`;
}
function specOf(d: CacheDescriptor): Spec {
	const spec = SPECS[op(d)];
	if (!spec) throw new TypeError("Unknown admin report operation");
	return spec;
}
function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function whole(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function bounded(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}
function pagePair(p: CacheParams): void {
	if (!positive(p.page) || !positive(p.limit) || Number(p.limit) > LIST_PAGE_SIZE_MAX)
		throw new TypeError("Invalid pagination");
}

export function localTodayStart(now: number): number {
	return Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
}
export function dayLocalToIso(dayLocal: number): string {
	const d = new Date(dayLocal * DAY * 1000);
	return `${d.getUTCFullYear().toString().padStart(4, "0")}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}-${d.getUTCDate().toString().padStart(2, "0")}`;
}
export function localTodayIso(nowSec: number): string {
	return dayLocalToIso(Math.floor((localTodayStart(nowSec) + OFFSET) / DAY));
}
export function shanghaiDateLocal(nowSec: number): string {
	return localTodayIso(nowSec);
}
export function shanghaiStart(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	return Math.floor(Date.UTC(y, m - 1, d) / 1000) - OFFSET;
}
export function fillDaily(
	rows: Array<{ day_local: number; count: number }>,
	days: number,
	nowSec: number,
): Array<{ date: string; count: number }> {
	const todayLocal = Math.floor((localTodayStart(nowSec) + OFFSET) / DAY);
	const byDay = new Map(rows.map((row) => [row.day_local, row.count]));
	return Array.from({ length: days }, (_, i) => {
		const day = todayLocal - (days - 1) + i;
		return { date: dayLocalToIso(day), count: byDay.get(day) ?? 0 };
	});
}
export function fillDailyByIso(
	rows: Array<{ date_local: string; count: number }>,
	days: number,
	nowSec: number,
): Array<{ date: string; count: number }> {
	const todayLocal = Math.floor((localTodayStart(nowSec) + OFFSET) / DAY);
	const byDay = new Map(rows.map((row) => [row.date_local, row.count]));
	return Array.from({ length: days }, (_, i) => {
		const iso = dayLocalToIso(todayLocal - (days - 1) + i);
		return { date: iso, count: byDay.get(iso) ?? 0 };
	});
}
export function rangeDays(range: Range): number {
	return range === "7d" ? 7 : range === "30d" ? 30 : 90;
}
export function maskIp(ip: string): string {
	if (ip?.includes(".")) {
		const parts = ip.split(".");
		if (parts.length === 4 && parts.every((part) => part.length > 0 && /^\d+$/.test(part)))
			return `${parts[0]}.${parts[1]}.x.x`;
	}
	if (ip?.includes(":")) {
		const parts = ip.split(":");
		if (parts.length >= 3 && parts[0].length > 0 && parts[1].length > 0)
			return `${parts[0]}:${parts[1]}::x`;
	}
	return "unknown";
}

function optionalNull(
	spec: Spec,
	p: CacheParams,
	name: string,
	ok: (value: unknown) => boolean,
	label: string,
): void {
	if (spec.keys.includes(name) && p[name] !== null && !ok(p[name]))
		throw new TypeError(`Invalid ${label}`);
}
function assertDescriptorParams(spec: Spec, p: CacheParams): void {
	if (Object.keys(p).sort().join(",") !== [...spec.keys].sort().join(","))
		throw new TypeError("Invalid admin report dimensions");
	if (spec.keys.includes("page")) pagePair(p);
	if (spec.keys.includes("id") && !positive(p.id)) throw new TypeError("Invalid admin report id");
	if (spec.keys.includes("userId") && !positive(p.userId)) throw new TypeError("Invalid user id");
	if (spec.keys.includes("date") && !isValidShanghaiDateLocal(p.date))
		throw new TypeError("Invalid date");
	if (
		(spec.keys.includes("from") || spec.keys.includes("to")) &&
		(!isValidShanghaiDateLocal(p.from) ||
			!isValidShanghaiDateLocal(p.to) ||
			String(p.from) > String(p.to))
	) {
		throw new TypeError("Invalid checkin range");
	}
	if (spec.keys.includes("range") && !ALLOWED_RANGES.includes(p.range as Range))
		throw new TypeError("Invalid range");
	if (spec.keys.includes("metric") && !ALLOWED_METRICS.includes(p.metric as TrendMetric))
		throw new TypeError("Invalid metric");
	optionalNull(
		spec,
		p,
		"status",
		(value) => ["pending", "resolved", "dismissed"].includes(String(value)),
		"status",
	);
	optionalNull(
		spec,
		p,
		"type",
		(value) => ["thread", "post", "user"].includes(String(value)),
		"type",
	);
	optionalNull(spec, p, "kind", (value) => ["login", "register"].includes(String(value)), "kind");
	optionalNull(spec, p, "ok", (value) => value === 0 || value === 1, "ok filter");
	optionalNull(
		spec,
		p,
		"pathKind",
		(value) => PATH_KIND_VALUES.has(value as PathKind),
		"path kind",
	);
	optionalNull(spec, p, "errorCode", (value) => bounded(value, 64), "error code");
	optionalNull(spec, p, "action", (value) => bounded(value, 128), "action");
	optionalNull(spec, p, "targetType", (value) => bounded(value, 64), "target type");
	for (const name of ["reporterId", "adminId", "targetId"] as const)
		optionalNull(spec, p, name, positive, name);
	for (const name of ["startDate", "endDate"] as const) optionalNull(spec, p, name, whole, name);
}

export function validateAdminReportDescriptor(d: CacheDescriptor): Spec {
	if (d.scope !== "admin") throw new TypeError("Admin scope is required");
	const spec = specOf(d);
	if (d.family !== spec.family) throw new TypeError("Admin report family does not match operation");
	if (d.params.resource !== op(d).split(":")[0] || d.params.operation !== op(d).split(":")[1])
		throw new TypeError("Invalid admin report operation");
	assertDescriptorParams(spec, d.params);
	return spec;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value);
}
function maskedIp(value: unknown): boolean {
	return (
		typeof value === "string" &&
		(value === "unknown" || /^\d+\.\d+\.x\.x$/.test(value) || /^[^:]+:[^:]+::x$/.test(value))
	);
}
function pageMeta(value: Record<string, unknown>): boolean {
	return (
		positive(value.page) &&
		positive(value.limit) &&
		Number(value.limit) <= LIST_PAGE_SIZE_MAX &&
		finite(value.total) &&
		Number(value.total) >= 0
	);
}
function series(value: unknown, range: unknown): boolean {
	return (
		Array.isArray(value) &&
		ALLOWED_RANGES.includes(range as Range) &&
		value.length === rangeDays(range as Range) &&
		value.every(
			(row) =>
				record(row) &&
				isValidShanghaiDateLocal(row.date) &&
				finite(row.count) &&
				Number(row.count) >= 0,
		)
	);
}
function isReport(value: unknown): boolean {
	return (
		record(value) &&
		positive(value.id) &&
		typeof value.type === "string" &&
		positive(value.targetId) &&
		positive(value.reporterId) &&
		typeof value.reporterName === "string" &&
		typeof value.reason === "string" &&
		typeof value.status === "string" &&
		typeof value.handlerName === "string" &&
		finite(value.createdAt) &&
		(value.handlerId === null || finite(value.handlerId)) &&
		(value.handledAt === null || finite(value.handledAt)) &&
		(value.threadId === null || finite(value.threadId)) &&
		(value.targetTitle === null || typeof value.targetTitle === "string") &&
		(value.targetName === null || typeof value.targetName === "string")
	);
}

function isLoginRow(row: unknown): boolean {
	return (
		record(row) &&
		positive(row.id) &&
		typeof row.username === "string" &&
		(row.userId === null || finite(row.userId)) &&
		(row.ok === 0 || row.ok === 1) &&
		typeof row.kind === "string" &&
		typeof row.errorCode === "string" &&
		maskedIp(row.ip) &&
		typeof row.userAgent === "string" &&
		typeof row.botClass === "string" &&
		finite(row.createdAt)
	);
}
function isVisitKpi(d: CacheDescriptor, value: Record<string, unknown>): boolean {
	return (
		finite(value.now) &&
		value.dateLocal === d.params.date &&
		value.anonPresent === null &&
		value.activeUsers === null &&
		[
			"totalViews",
			"humanViews",
			"botSearchViews",
			"botOtherViews",
			"unknownViews",
			"distinctTargets",
		].every((key) => finite(value[key])) &&
		Array.isArray(value.byPathKind) &&
		value.byPathKind.every(
			(row) =>
				record(row) &&
				PATH_KIND_VALUES.has(row.pathKind as PathKind) &&
				finite(row.views) &&
				finite(row.targets),
		)
	);
}
function isVisitRow(row: unknown): boolean {
	return (
		record(row) &&
		row.uniqueUsers === null &&
		PATH_KIND_VALUES.has(row.pathKind as PathKind) &&
		finite(row.targetId) &&
		typeof row.label === "string" &&
		[
			"views",
			"humanViews",
			"botSearchViews",
			"botOtherViews",
			"unknownViews",
			"firstSeenAt",
			"lastSeenAt",
		].every((key) => finite(row[key]))
	);
}
function isCheckinUser(d: CacheDescriptor, value: Record<string, unknown>): boolean {
	const checkin = value.checkin;
	const range = value.range;
	return (
		value.userId === d.params.userId &&
		typeof value.username === "string" &&
		typeof value.truncated === "boolean" &&
		record(range) &&
		range.from === d.params.from &&
		range.to === d.params.to &&
		Array.isArray(value.history) &&
		(checkin === null ||
			(record(checkin) &&
				checkin.userId === d.params.userId &&
				[
					"totalDays",
					"monthDays",
					"streakDays",
					"rewardTotal",
					"lastReward",
					"lastCheckinAt",
				].every((key) => finite(checkin[key])) &&
				typeof checkin.mood === "string" &&
				typeof checkin.message === "string")) &&
		value.history.every(
			(row) =>
				record(row) &&
				row.userId === d.params.userId &&
				isValidShanghaiDateLocal(row.dateLocal) &&
				typeof row.mood === "string" &&
				typeof row.message === "string" &&
				finite(row.reward) &&
				finite(row.createdAt),
		)
	);
}
function isStatsTotals(value: Record<string, unknown>): boolean {
	return (
		value.source === "stored-counters" &&
		finite(value.observedAt) &&
		Object.keys(value).length === 5 &&
		["users", "threads", "posts"].every((key) => {
			const entry = value[key];
			return (
				record(entry) &&
				Object.keys(entry).length === 1 &&
				(entry.total === null || (Number.isSafeInteger(entry.total) && Number(entry.total) >= 0))
			);
		})
	);
}
function isAdminLogRow(row: unknown): boolean {
	return (
		record(row) &&
		positive(row.id) &&
		finite(row.adminId) &&
		typeof row.adminName === "string" &&
		typeof row.action === "string" &&
		typeof row.targetType === "string" &&
		(row.targetId === null || finite(row.targetId)) &&
		typeof row.details === "string" &&
		maskedIp(row.ip) &&
		finite(row.createdAt)
	);
}

const SHAPES: Record<string, (d: CacheDescriptor, value: Record<string, unknown>) => boolean> = {
	"reports:list": (_d, value) =>
		pageMeta(value) && Array.isArray(value.items) && value.items.every(isReport),
	"reports:detail": (_d, value) => isReport(value),
	"analytics:overview": (_d, value) =>
		finite(value.now) &&
		record(value.today) &&
		["newUsers", "newThreads", "newPosts", "checkins"].every((key) =>
			finite((value.today as Record<string, unknown>)[key]),
		),
	"analytics:trend": (d, value) =>
		value.metric === d.params.metric &&
		value.range === d.params.range &&
		series(value.series, value.range),
	"analytics:forum-dist": (d, value) =>
		value.range === d.params.range &&
		Array.isArray(value.rows) &&
		value.rows.every(
			(row) =>
				record(row) &&
				finite(row.forumId) &&
				typeof row.forumName === "string" &&
				finite(row.posts),
		),
	"analytics:checkin-trend": (d, value) =>
		value.range === d.params.range && series(value.series, value.range),
	"logins:kpi": (_d, value) =>
		[
			"now",
			"dayStart",
			"totalAttempts",
			"successAttempts",
			"failedAttempts",
			"uniqueUsers",
			"uniqueIps",
			"loginAttempts",
			"registerAttempts",
		].every((key) => finite(value[key])),
	"logins:list": (_d, value) =>
		pageMeta(value) && Array.isArray(value.rows) && value.rows.every(isLoginRow),
	"visits:kpi": isVisitKpi,
	"visits:list": (_d, value) =>
		pageMeta(value) && Array.isArray(value.rows) && value.rows.every(isVisitRow),
	"checkins:user": isCheckinUser,
	"stats:totals": (_d, value) => isStatsTotals(value),
	"admin-logs:list": (_d, value) =>
		pageMeta(value) && Array.isArray(value.items) && value.items.every(isAdminLogRow),
};

/** Shared by live reads and manager inspect/rebuild. */
export function isAdminReportCacheData(descriptor: CacheDescriptor, value: unknown): boolean {
	try {
		validateAdminReportDescriptor(descriptor);
	} catch {
		return false;
	}
	const kind = op(descriptor);
	if (value === null) return kind === "reports:detail" || kind === "checkins:user";
	if (!record(value)) return false;
	return SHAPES[kind]?.(descriptor, value) ?? false;
}

/** KV-only key material: normalized dimensions plus the reports gen for MEDIUM aggregates. */
export async function adminReportCacheKey(env: Env, descriptor: CacheDescriptor): Promise<string> {
	const spec = validateAdminReportDescriptor(descriptor);
	const gens: Record<string, string> =
		spec.tier === "MEDIUM" ? { reports: await getGen(env, statsReportsGenKey()) } : {};
	return dataCacheKey(descriptor.family, descriptor.params, descriptor.scope, gens);
}

async function loadAdminReport(env: Env, d: CacheDescriptor): Promise<unknown> {
	validateAdminReportDescriptor(d);
	const loader = LOADERS[op(d)];
	if (!loader) throw new TypeError("Unknown admin report operation");
	return loader(env, d);
}

export async function rebuildAdminReportCache(
	env: Env,
	_ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
): Promise<unknown> {
	return loadAdminReport(env, descriptor);
}

export async function getAdminReport<T>(
	env: Env,
	ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
): Promise<T> {
	const spec = validateAdminReportDescriptor(descriptor);
	// Ephemeral visits must never outlive the memory actor through a KV snapshot.
	if (descriptor.params.resource === "visits")
		return loadAdminReport(env, descriptor) as Promise<T>;
	return cacheGetOrSet(
		env,
		ctx,
		await adminReportCacheKey(env, descriptor),
		() => loadAdminReport(env, descriptor) as Promise<T>,
		{
			family: descriptor.family,
			tier: spec.tier,
			params: descriptor.params,
			scope: "admin",
			source: "admin",
			validator: (value): value is T => isAdminReportCacheData(descriptor, value),
		},
	);
}

function toReport(row: Record<string, unknown>) {
	return {
		id: row.id as number,
		type: row.type as string,
		targetId: row.target_id as number,
		reporterId: row.reporter_id as number,
		reporterName: row.reporter_name as string,
		reason: row.reason as string,
		status: row.status as string,
		handlerId: row.handler_id as number | null,
		handlerName: row.handler_name as string,
		handledAt: row.handled_at as number | null,
		createdAt: row.created_at as number,
		threadId: (row.thread_id as number | null) ?? null,
		targetTitle: (row.target_title as string | null) ?? null,
		targetName: (row.target_name as string | null) ?? null,
	};
}
function toAdminLog(row: Record<string, unknown>) {
	return {
		id: row.id as number,
		adminId: row.admin_id as number,
		adminName: row.admin_name as string,
		action: row.action as string,
		targetType: row.target_type as string,
		targetId: row.target_id as number | null,
		details: row.details as string,
		ip: maskIp(String(row.ip ?? "")),
		createdAt: row.created_at as number,
	};
}
function toUserCheckin(row: {
	user_id: number;
	total_days: number;
	month_days: number;
	streak_days: number;
	reward_total: number;
	last_reward: number;
	mood: string;
	message: string;
	last_checkin_at: number;
}): UserCheckin {
	return {
		userId: row.user_id,
		totalDays: row.total_days,
		monthDays: row.month_days,
		streakDays: row.streak_days,
		rewardTotal: row.reward_total,
		lastReward: row.last_reward,
		mood: row.mood,
		message: row.message,
		lastCheckinAt: row.last_checkin_at,
	};
}

function requireAll<T>(result: { success?: boolean; results?: T[] }, message: string): T[] {
	if (!result.success || !Array.isArray(result.results)) throw new Error(message);
	return result.results;
}
function requireBatch(
	results: Array<{ success?: boolean }>,
	expected: number,
	message: string,
): void {
	if (results.length < expected || results.some((row) => !row.success)) throw new Error(message);
}
function countOf(row: { cnt?: number; total?: number } | null | undefined): number {
	return Number(row?.cnt ?? row?.total ?? 0);
}

export async function loadReportsList(env: Env, d: CacheDescriptor) {
	const p = d.params;
	const conditions: string[] = [];
	const binds: unknown[] = [];
	if (p.status !== null) {
		conditions.push("r.status = ?");
		binds.push(p.status);
	}
	if (p.type !== null) {
		conditions.push("r.type = ?");
		binds.push(p.type);
	}
	if (p.reporterId !== null) {
		conditions.push("r.reporter_id = ?");
		binds.push(p.reporterId);
	}
	const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
	const page = Number(p.page);
	const limit = Number(p.limit);
	const [countRow, result] = await Promise.all([
		env.DB.prepare(`SELECT COUNT(*) as total FROM reports r ${where}`)
			.bind(...binds)
			.first<{ total: number }>(),
		env.DB.prepare(
			`SELECT ${REPORT_JOIN_COLUMNS} ${REPORT_JOIN_FROM} ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
		)
			.bind(...binds, limit, (page - 1) * limit)
			.all(),
	]);
	return {
		items: requireAll(result, "Report list could not be loaded").map((row) =>
			toReport(row as Record<string, unknown>),
		),
		total: countOf(countRow),
		page,
		limit,
	};
}
export async function loadReportDetail(env: Env, d: CacheDescriptor) {
	const row = await env.DB.prepare(
		`SELECT ${REPORT_JOIN_COLUMNS} ${REPORT_JOIN_FROM} WHERE r.id = ?`,
	)
		.bind(d.params.id)
		.first();
	return row ? toReport(row as Record<string, unknown>) : null;
}

async function loadOverview(env: Env, d: CacheDescriptor) {
	const nowSec = shanghaiStart(String(d.params.date));
	const results = await env.DB.batch([
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM users WHERE reg_date >= ?").bind(nowSec),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM threads WHERE created_at >= ?").bind(nowSec),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM posts WHERE created_at >= ?").bind(nowSec),
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM checkin_history WHERE date_local = ?").bind(
			d.params.date,
		),
	]);
	requireBatch(results, 4, "Analytics overview could not be loaded");
	const get = (i: number) => countOf(results[i]?.results?.[0] as { cnt?: number } | undefined);
	return {
		now: Math.floor(Date.now() / 1000),
		today: { newUsers: get(0), newThreads: get(1), newPosts: get(2), checkins: get(3) },
	};
}
async function loadTrend(env: Env, d: CacheDescriptor) {
	const nowSec = shanghaiStart(String(d.params.date));
	const metric = d.params.metric as TrendMetric;
	const range = d.params.range as Range;
	const days = rangeDays(range);
	if (metric === "checkins") {
		const startIso = dayLocalToIso(Math.floor((nowSec + OFFSET) / DAY) - (days - 1));
		const rs = await env.DB.prepare(`
			SELECT date_local AS date_local,
			       COUNT(*) AS count
			FROM checkin_history
			WHERE date_local >= ? AND date_local <= ?
			GROUP BY date_local
			ORDER BY date_local ASC
		`)
			.bind(startIso, d.params.date)
			.all<{ date_local: string; count: number }>();
		return {
			metric,
			range,
			series: fillDailyByIso(requireAll(rs, "Checkin trend could not be loaded"), days, nowSec),
		};
	}
	const column = metric === "users" ? "reg_date" : "created_at";
	const table = metric === "users" ? "users" : metric === "threads" ? "threads" : "posts";
	const rs = await env.DB.prepare(`
			SELECT ((${column} + ${OFFSET}) / ${DAY}) AS day_local,
			       COUNT(*) AS count
			FROM ${table}
			WHERE ${column} >= ?
			GROUP BY day_local
			ORDER BY day_local ASC
		`)
		.bind(nowSec - (days - 1) * DAY)
		.all<{ day_local: number; count: number }>();
	return {
		metric,
		range,
		series: fillDaily(requireAll(rs, "Trend could not be loaded"), days, nowSec),
	};
}
async function loadForumDist(env: Env, d: CacheDescriptor) {
	const nowSec = shanghaiStart(String(d.params.date));
	const range = d.params.range as Range;
	const rs = await env.DB.prepare(`
		SELECT p.forum_id  AS forum_id,
		       COALESCE(f.name, '') AS forum_name,
		       COUNT(*)    AS posts
		FROM posts p INDEXED BY idx_posts_created
		LEFT JOIN forums f ON f.id = p.forum_id
		WHERE p.created_at >= ?
		  AND COALESCE(f.status, -1) >= 0
		GROUP BY p.forum_id
		ORDER BY posts DESC, p.forum_id ASC
		LIMIT ?
	`)
		.bind(nowSec - (rangeDays(range) - 1) * DAY, FORUM_DIST_LIMIT)
		.all<{ forum_id: number; forum_name: string; posts: number }>();
	return {
		range,
		rows: requireAll(rs, "Forum distribution could not be loaded").map((row) => ({
			forumId: row.forum_id,
			forumName: row.forum_name,
			posts: row.posts,
		})),
	};
}
async function loadCheckinTrend(env: Env, d: CacheDescriptor) {
	const nowSec = shanghaiStart(String(d.params.date));
	const range = d.params.range as Range;
	const days = rangeDays(range);
	const startIso = dayLocalToIso(Math.floor((nowSec + OFFSET) / DAY) - (days - 1));
	const rs = await env.DB.prepare(`
		SELECT date_local AS date_local,
		       COUNT(*) AS count
		FROM checkin_history
		WHERE date_local >= ? AND date_local <= ?
		GROUP BY date_local
		ORDER BY date_local ASC
	`)
		.bind(startIso, d.params.date)
		.all<{ date_local: string; count: number }>();
	return {
		range,
		series: fillDailyByIso(requireAll(rs, "Checkin trend could not be loaded"), days, nowSec),
	};
}

export async function loadLoginsKpi(env: Env, d: CacheDescriptor) {
	const dayStart = shanghaiStart(String(d.params.date));
	const row = await env.DB.prepare(
		`SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS success,
			SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
			COUNT(DISTINCT CASE WHEN ok = 1 AND user_id IS NOT NULL THEN user_id END) AS unique_users,
			COUNT(DISTINCT ip) AS unique_ips,
			SUM(CASE WHEN kind = 'login' THEN 1 ELSE 0 END) AS login_attempts,
			SUM(CASE WHEN kind = 'register' THEN 1 ELSE 0 END) AS register_attempts
		FROM login_history
		WHERE created_at >= ?`,
	)
		.bind(dayStart)
		.first<{
			total: number | null;
			success: number | null;
			failed: number | null;
			unique_users: number | null;
			unique_ips: number | null;
			login_attempts: number | null;
			register_attempts: number | null;
		}>();
	return {
		now: Math.floor(Date.now() / 1000),
		dayStart,
		totalAttempts: Number(row?.total ?? 0),
		successAttempts: Number(row?.success ?? 0),
		failedAttempts: Number(row?.failed ?? 0),
		uniqueUsers: Number(row?.unique_users ?? 0),
		uniqueIps: Number(row?.unique_ips ?? 0),
		loginAttempts: Number(row?.login_attempts ?? 0),
		registerAttempts: Number(row?.register_attempts ?? 0),
	};
}
export async function loadLoginsList(env: Env, d: CacheDescriptor) {
	const p = d.params;
	const conditions = ["created_at >= ?"];
	const binds: unknown[] = [shanghaiStart(String(p.date))];
	if (p.ok !== null) {
		conditions.push("ok = ?");
		binds.push(p.ok);
	}
	if (p.kind !== null) {
		conditions.push("kind = ?");
		binds.push(p.kind);
	}
	if (p.errorCode !== null) {
		conditions.push("error_code = ?");
		binds.push(p.errorCode);
	}
	const where = conditions.join(" AND ");
	const page = Number(p.page);
	const limit = Number(p.limit);
	const [countRow, listResult] = await Promise.all([
		env.DB.prepare(`SELECT COUNT(*) AS total FROM login_history WHERE ${where}`)
			.bind(...binds)
			.first<{ total: number }>(),
		env.DB.prepare(
			`SELECT id, user_id, username, ok, kind, error_code, ip, user_agent, bot_class, created_at
			 FROM login_history
			 WHERE ${where}
			 ORDER BY created_at DESC
			 LIMIT ? OFFSET ?`,
		)
			.bind(...binds, limit, (page - 1) * limit)
			.all<{
				id: number;
				user_id: number | null;
				username: string;
				ok: 0 | 1;
				kind: string;
				error_code: string;
				ip: string;
				user_agent: string;
				bot_class: string;
				created_at: number;
			}>(),
	]);
	return {
		page,
		limit,
		total: countOf(countRow),
		rows: requireAll(listResult, "Login list could not be loaded").map((row) => ({
			id: row.id,
			userId: row.user_id,
			username: row.username,
			ok: row.ok,
			kind: row.kind,
			errorCode: row.error_code,
			ip: maskIp(row.ip),
			userAgent: row.user_agent,
			botClass: row.bot_class,
			createdAt: row.created_at,
		})),
	};
}

export async function loadVisitsKpi(env: Env, d: CacheDescriptor) {
	const date = String(d.params.date);
	return todayVisitsMemory(env, date).kpi(date);
}
export async function loadVisitsList(env: Env, d: CacheDescriptor) {
	const p = d.params;
	const result = await todayVisitsMemory(env, String(p.date)).list(
		p.pathKind as PathKind | null,
		Number(p.page),
		Number(p.limit),
	);
	const labels = await resolveLabels(
		env,
		result.rows.map((row) => ({ path_kind: row.pathKind, target_id: row.targetId })),
	);
	return {
		...result,
		rows: result.rows.map((row) => ({
			...row,
			label: labels.get(`${row.pathKind}#${row.targetId}`) ?? "",
		})),
	};
}
export async function resolveLabels(
	env: Env,
	rows: Array<{ path_kind: string; target_id: number }>,
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const groups = { thread: [] as number[], forum: [] as number[], user: [] as number[] };
	for (const row of rows) {
		if (row.target_id <= 0) continue;
		if (row.path_kind === "thread") groups.thread.push(row.target_id);
		else if (row.path_kind === "forum") groups.forum.push(row.target_id);
		else if (row.path_kind === "user") groups.user.push(row.target_id);
	}
	const load = async (ids: number[], sql: string, field: string, prefix: string) => {
		if (!ids.length) return;
		const unique = [...new Set(ids)];
		const rs = await env.DB.prepare(`${sql} (${unique.map(() => "?").join(",")})`)
			.bind(...unique)
			.all<{ id: number } & Record<string, string>>();
		for (const row of requireAll(rs, "Visit labels could not be loaded"))
			out.set(`${prefix}#${row.id}`, row[field] ?? "");
	};
	await Promise.all([
		load(groups.thread, "SELECT id, subject FROM threads WHERE id IN", "subject", "thread"),
		load(groups.forum, "SELECT id, name FROM forums WHERE id IN", "name", "forum"),
		load(groups.user, "SELECT id, username FROM users WHERE id IN", "username", "user"),
	]);
	return out;
}

export async function loadUserCheckins(env: Env, d: CacheDescriptor) {
	const userId = Number(d.params.userId);
	const from = String(d.params.from);
	const to = String(d.params.to);
	const [user, aggregate, history] = await Promise.all([
		env.DB.prepare("SELECT id, username, status FROM users WHERE id = ?")
			.bind(userId)
			.first<{ id: number; username: string; status: number }>(),
		env.DB.prepare("SELECT * FROM user_checkins WHERE user_id = ?").bind(userId).first<{
			user_id: number;
			total_days: number;
			month_days: number;
			streak_days: number;
			reward_total: number;
			last_reward: number;
			mood: string;
			message: string;
			last_checkin_at: number;
		}>(),
		env.DB.prepare(
			`SELECT user_id, date_local, mood, message, reward, created_at
				 FROM checkin_history
				 WHERE user_id = ? AND date_local >= ? AND date_local <= ?
				 ORDER BY date_local DESC
				 LIMIT ?`,
		)
			.bind(userId, from, to, MAX_HISTORY_ROWS)
			.all<{
				user_id: number;
				date_local: string;
				mood: string;
				message: string;
				reward: number;
				created_at: number;
			}>(),
	]);
	if (!user || user.status === -99) return null;
	const historyRows = requireAll(history, "Checkin history could not be loaded");
	const mapped: CheckinHistoryEntry[] = historyRows.map((row) => ({
		userId: row.user_id,
		dateLocal: row.date_local,
		mood: row.mood,
		message: row.message,
		reward: row.reward,
		createdAt: row.created_at,
	}));
	return {
		userId,
		username: user.username,
		checkin: aggregate ? toUserCheckin(aggregate) : null,
		history: mapped,
		range: { from, to },
		truncated: mapped.length === MAX_HISTORY_ROWS,
	};
}

export async function loadStatsTotals(env: Env, _d: CacheDescriptor) {
	const keys = ["stats.total_members", "stats.total_threads", "stats.total_posts"];
	const result = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN (?, ?, ?)")
		.bind(...keys)
		.all<{ key: string; value: string }>();
	const rows = requireAll(result, "Stored statistics could not be loaded");
	const values = new Map(rows.map((row) => [row.key, row.value]));
	const count = (key: string): number | null => {
		const value = values.get(key);
		if (value === undefined) return null;
		const number = Number(value);
		if (!/^\d+$/.test(value) || !Number.isSafeInteger(number))
			throw new Error("Invalid stored statistics counter");
		return number;
	};
	return {
		users: { total: count(keys[0]) },
		threads: { total: count(keys[1]) },
		posts: { total: count(keys[2]) },
		source: "stored-counters",
		observedAt: Date.now(),
	};
}

export async function loadAdminLogsList(env: Env, d: CacheDescriptor) {
	const p = d.params;
	const conditions: string[] = [];
	const binds: unknown[] = [];
	if (p.adminId !== null) {
		conditions.push("admin_id = ?");
		binds.push(p.adminId);
	}
	if (p.action !== null) {
		conditions.push("action = ?");
		binds.push(p.action);
	}
	if (p.targetType !== null) {
		conditions.push("target_type = ?");
		binds.push(p.targetType);
	}
	if (p.targetId !== null) {
		conditions.push("target_id = ?");
		binds.push(p.targetId);
	}
	if (p.startDate !== null) {
		conditions.push("created_at >= ?");
		binds.push(p.startDate);
	}
	if (p.endDate !== null) {
		conditions.push("created_at <= ?");
		binds.push(p.endDate);
	}
	const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
	const page = Number(p.page);
	const limit = Number(p.limit);
	const [countRow, result] = await Promise.all([
		env.DB.prepare(`SELECT COUNT(*) as total FROM admin_logs ${where}`)
			.bind(...binds)
			.first<{ total: number }>(),
		env.DB.prepare(
			`SELECT ${ADMIN_LOG_COLUMNS} FROM admin_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		)
			.bind(...binds, limit, (page - 1) * limit)
			.all(),
	]);
	return {
		items: requireAll(result, "Admin logs could not be loaded").map((row) =>
			toAdminLog(row as Record<string, unknown>),
		),
		total: countOf(countRow),
		page,
		limit,
	};
}

const LOADERS: Record<string, (env: Env, d: CacheDescriptor) => Promise<unknown>> = {
	"reports:list": loadReportsList,
	"reports:detail": loadReportDetail,
	"analytics:overview": loadOverview,
	"analytics:trend": loadTrend,
	"analytics:forum-dist": loadForumDist,
	"analytics:checkin-trend": loadCheckinTrend,
	"logins:kpi": loadLoginsKpi,
	"logins:list": loadLoginsList,
	"visits:kpi": loadVisitsKpi,
	"visits:list": loadVisitsList,
	"checkins:user": loadUserCheckins,
	"stats:totals": loadStatsTotals,
	"admin-logs:list": loadAdminLogsList,
};
