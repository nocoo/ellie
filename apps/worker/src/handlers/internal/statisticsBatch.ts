import {
	observedAtInRange,
	parseStatisticsBatchRequest,
	STATISTICS_BATCH_HTTP_STATUS,
	STATISTICS_BATCH_MAX_BODY_BYTES,
	STATISTICS_BATCH_MESSAGES,
	STATISTICS_BATCH_NO_STORE,
	STATISTICS_WRITE_HEADER,
	type StatisticsActivityResult,
	type StatisticsBatchErrorCode,
	type StatisticsBatchRequest,
	type StatisticsBatchResult,
	type StatisticsViewResult,
	type StatisticsWriteStatus,
	statisticsBatchErrorEnvelope,
	UserStatus,
} from "@ellie/types";
import { constantTimeEqualStr } from "../../lib/constant-time";
import type { Env } from "../../lib/env";

const CHUNK = 20;
const JSON_HEADERS = {
	"Content-Type": "application/json",
	"Cache-Control": STATISTICS_BATCH_NO_STORE,
};

/** Stop at `limit` bytes and cancel the rest. Does not buffer an unbounded stream. */
export async function readBoundedBody(
	request: Request,
	limit: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
	const body = request.body;
	if (!body) return { ok: true, bytes: new Uint8Array() };
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let cancelled = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;
			if (total + value.byteLength > limit) {
				cancelled = true;
				await reader.cancel();
				return { ok: false };
			}
			chunks.push(value);
			total += value.byteLength;
		}
	} finally {
		if (!cancelled) reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { ok: true, bytes };
}

export async function statisticsBatchHandler(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") {
		return error("METHOD_NOT_ALLOWED", STATISTICS_BATCH_MESSAGES.methodNotAllowed);
	}
	const configured = env.WEB_STATISTICS_WRITE_KEY;
	if (!configured) return error("NOT_CONFIGURED", STATISTICS_BATCH_MESSAGES.notConfigured);
	const presented = request.headers.get(STATISTICS_WRITE_HEADER) ?? "";
	if (!presented || !constantTimeEqualStr(presented, configured)) {
		return error("UNAUTHORIZED", STATISTICS_BATCH_MESSAGES.unauthorized);
	}

	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().startsWith("application/json")) {
		return error("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidContentType);
	}
	const declared = request.headers.get("content-length");
	if (
		declared !== null &&
		(!/^\d+$/.test(declared) || Number(declared) > STATISTICS_BATCH_MAX_BODY_BYTES)
	) {
		return error("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.bodyTooLarge);
	}
	const bounded = await readBoundedBody(request, STATISTICS_BATCH_MAX_BODY_BYTES);
	if (!bounded.ok) return error("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.bodyTooLarge);
	const bytes = bounded.bytes;
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return error("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.invalidJson);
	}
	const parsed = parseStatisticsBatchRequest(raw);
	if (!parsed.ok) return error(parsed.error.code, parsed.error.message);
	const now = Math.floor(Date.now() / 1000);
	if (parsed.value.activities.some((item) => !observedAtInRange(item.observedAt, now))) {
		return error("BAD_REQUEST", STATISTICS_BATCH_MESSAGES.observedAtOutOfRange);
	}

	const [views, activities] = await Promise.all([
		writeViews(env, parsed.value),
		writeActivities(env, parsed.value),
	]);
	return json({ views, activities });
}

async function writeViews(
	env: Env,
	batch: StatisticsBatchRequest,
): Promise<StatisticsViewResult[]> {
	return writeChunked(env, batch.views, (item) =>
		env.DB.prepare("UPDATE threads SET views = views + ? WHERE id = ? AND sticky >= 0").bind(
			item.increment,
			item.threadId,
		),
	);
}

async function writeActivities(
	env: Env,
	batch: StatisticsBatchRequest,
): Promise<StatisticsActivityResult[]> {
	return writeChunked(env, batch.activities, (item) =>
		env.DB.prepare(
			"UPDATE users SET last_activity = MAX(last_activity, ?) WHERE id = ? AND status = ?",
		).bind(item.observedAt, item.userId, UserStatus.Active),
	);
}

async function writeChunked<T extends { threadId: number } | { userId: number }>(
	env: Env,
	items: T[],
	statement: (item: T) => D1PreparedStatement,
): Promise<Array<T & { status: StatisticsWriteStatus }>> {
	const results: Array<T & { status: StatisticsWriteStatus }> = [];
	for (let start = 0; start < items.length; start += CHUNK) {
		const slice = items.slice(start, start + CHUNK);
		try {
			const settled = await env.DB.batch(slice.map(statement));
			slice.forEach((item, index) => {
				results.push({ ...item, status: statusOf(settled[index]) });
			});
		} catch {
			for (const item of slice) results.push({ ...item, status: "unconfirmed" });
		}
	}
	return results;
}

function statusOf(result: D1Result | undefined): StatisticsWriteStatus {
	if (!result?.success) return "unconfirmed";
	return (result.meta?.changes ?? 0) > 0 ? "confirmed" : "rejected";
}

function json(data: StatisticsBatchResult): Response {
	return new Response(JSON.stringify({ data }), { status: 200, headers: JSON_HEADERS });
}

function error(code: StatisticsBatchErrorCode, message: string): Response {
	return new Response(JSON.stringify(statisticsBatchErrorEnvelope(code, message)), {
		status: STATISTICS_BATCH_HTTP_STATUS[code],
		headers: JSON_HEADERS,
	});
}
