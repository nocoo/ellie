import { createHash, timingSafeEqual } from "node:crypto";
import {
	MEMORY_CACHE_ADMIN_HEADER,
	MEMORY_CACHE_HTTP_STATUS,
	MEMORY_CACHE_MESSAGES,
	type MemoryCacheErrorCode,
	memoryCacheErrorEnvelope,
	parseMemoryCacheMutation,
	parseMemoryCacheQuery,
} from "@ellie/types";
import { getMemoryRuntime, readBoundedJson } from "@/lib/memory-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function respond(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(code: MemoryCacheErrorCode, message: string): Response {
	return respond(memoryCacheErrorEnvelope(code, message), MEMORY_CACHE_HTTP_STATUS[code]);
}

function authorize(request: Request): Response | null {
	const expected = process.env.MEMORY_CACHE_ADMIN_KEY;
	if (!expected) return fail("NOT_CONFIGURED", MEMORY_CACHE_MESSAGES.notConfigured);
	const actual = request.headers.get(MEMORY_CACHE_ADMIN_HEADER) ?? "";
	const digest = (value: string) => createHash("sha256").update(value).digest();
	if (!actual || !timingSafeEqual(digest(actual), digest(expected)))
		return fail("UNAUTHORIZED", MEMORY_CACHE_MESSAGES.unauthorized);
	return null;
}

export async function GET(request: Request): Promise<Response> {
	const denied = authorize(request);
	if (denied) return denied;
	const query = parseMemoryCacheQuery(new URL(request.url).searchParams);
	if (!query.ok) return fail(query.error.code, query.error.message);
	return respond({ data: getMemoryRuntime().snapshot(query.value) });
}

export async function POST(request: Request): Promise<Response> {
	const denied = authorize(request);
	if (denied) return denied;
	let input: unknown;
	try {
		input = await readBoundedJson(request, 4096);
	} catch {
		return fail("BAD_REQUEST", MEMORY_CACHE_MESSAGES.invalidBody);
	}
	const parsed = parseMemoryCacheMutation(input);
	if (!parsed.ok) return fail(parsed.error.code, parsed.error.message);
	const memory = getMemoryRuntime();
	const mutation = parsed.value;
	if (mutation.instanceId !== memory.id)
		return fail("INSTANCE_CONFLICT", MEMORY_CACHE_MESSAGES.instanceConflict);
	if (mutation.action === "flush") {
		if (!process.env.WORKER_API_URL || !process.env.WEB_STATISTICS_WRITE_KEY)
			return fail("NOT_CONFIGURED", MEMORY_CACHE_MESSAGES.notConfigured);
		await memory.flush();
	} else
		memory.clear(
			"family" in mutation ? mutation.family : undefined,
			"key" in mutation ? mutation.key : undefined,
		);
	return respond({ data: { ok: true } });
}
