import {
	MEMORY_CACHE_ADMIN_HEADER,
	MEMORY_CACHE_ERROR_CODES,
	MEMORY_CACHE_HTTP_STATUS,
	MEMORY_CACHE_MESSAGES,
	MEMORY_CACHE_NO_STORE,
	MEMORY_CACHE_WEB_PATH,
	type MemoryCacheOverview,
	memoryCacheErrorEnvelope,
	parseMemoryCacheMutation,
	parseMemoryCacheQuery,
} from "@ellie/types";
import { NextResponse } from "next/server";
import { createProxyHandler } from "@/lib/admin-proxy";

const UPSTREAM_READ_TIMEOUT_MS = 10_000;
const UPSTREAM_MUTATION_TIMEOUT_MS = 40_000;
// limit≤100 entries × 512-byte previews + counters — 2 MiB is a hard ceiling.
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 4 * 1024;

const NO_STORE = { "Cache-Control": MEMORY_CACHE_NO_STORE } as const;

function respond(status: number, body: unknown): NextResponse {
	return NextResponse.json(body, { status, headers: NO_STORE });
}

function fail(code: keyof typeof MEMORY_CACHE_HTTP_STATUS, message: string): NextResponse {
	return respond(MEMORY_CACHE_HTTP_STATUS[code], memoryCacheErrorEnvelope(code, message));
}

function upstreamFail(): NextResponse {
	return fail("UPSTREAM_UNAVAILABLE", MEMORY_CACHE_MESSAGES.upstreamUnavailable);
}

interface UpstreamConfig {
	base: string;
	key: string;
}

/**
 * Accept only an exact http(s) origin: no path, query, hash or credentials.
 * Anything else is a misconfiguration and fails closed as NOT_CONFIGURED —
 * a path would otherwise be silently stripped by URL(origin).
 */
function resolveUpstreamConfig(): UpstreamConfig | null {
	const base = process.env.WEB_MEMORY_ADMIN_URL?.trim();
	const key = process.env.MEMORY_CACHE_ADMIN_KEY;
	if (!base || !key) return null;
	try {
		const url = new URL(base);
		if (
			(url.protocol !== "https:" && url.protocol !== "http:") ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		) {
			return null;
		}
		return { base: url.origin, key };
	} catch {
		return null;
	}
}

interface BoundedBody {
	body: ReadableStream<Uint8Array> | null;
}

async function readBoundedText(source: BoundedBody, maxBytes: number): Promise<string> {
	const reader = source.body?.getReader();
	if (!reader) return "";
	try {
		const decoder = new TextDecoder();
		let text = "";
		let received = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) throw new Error("Body exceeds size ceiling");
			text += decoder.decode(value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

function isOverviewData(value: unknown): value is MemoryCacheOverview {
	if (typeof value !== "object" || value === null) return false;
	const o = value as Record<string, unknown>;
	return (
		typeof o.instance === "object" &&
		o.instance !== null &&
		typeof o.memory === "object" &&
		o.memory !== null &&
		Array.isArray(o.families) &&
		Array.isArray(o.entries) &&
		typeof o.buffers === "object" &&
		o.buffers !== null &&
		Array.isArray(o.history)
	);
}

function isMutationOkData(value: unknown): value is { ok: true } {
	return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true;
}

function isKnownEnvelopeError(value: unknown): value is { code: string; message: string } {
	if (typeof value !== "object" || value === null) return false;
	const e = value as Record<string, unknown>;
	return (
		typeof e.code === "string" &&
		(MEMORY_CACHE_ERROR_CODES as readonly string[]).includes(e.code) &&
		typeof e.message === "string"
	);
}

async function callUpstream(
	config: UpstreamConfig,
	method: "GET" | "POST",
	search: URLSearchParams,
	body?: string,
): Promise<NextResponse> {
	const url = new URL(MEMORY_CACHE_WEB_PATH, config.base);
	for (const [key, value] of search) url.searchParams.set(key, value);

	const headers: Record<string, string> = {
		Accept: "application/json",
		[MEMORY_CACHE_ADMIN_HEADER]: config.key,
	};
	if (body !== undefined) headers["Content-Type"] = "application/json";

	let res: Response;
	try {
		res = await fetch(url, {
			method,
			headers,
			body,
			redirect: "error",
			cache: MEMORY_CACHE_NO_STORE,
			signal: AbortSignal.timeout(
				method === "POST" ? UPSTREAM_MUTATION_TIMEOUT_MS : UPSTREAM_READ_TIMEOUT_MS,
			),
		});
	} catch {
		return upstreamFail();
	}

	let payload: unknown;
	try {
		const text = await readBoundedText(res, MAX_UPSTREAM_BYTES);
		payload = text ? JSON.parse(text) : null;
	} catch {
		return upstreamFail();
	}

	const envelope =
		typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;

	if (envelope && isKnownEnvelopeError(envelope.error)) {
		const code = envelope.error.code as keyof typeof MEMORY_CACHE_HTTP_STATUS;
		const status = MEMORY_CACHE_HTTP_STATUS[code] ?? MEMORY_CACHE_HTTP_STATUS.UPSTREAM_UNAVAILABLE;
		// Trust the error envelope only when the upstream HTTP status agrees.
		if (status === res.status) {
			const messages = {
				UNAUTHORIZED: MEMORY_CACHE_MESSAGES.unauthorized,
				BAD_REQUEST: MEMORY_CACHE_MESSAGES.invalidBody,
				INSTANCE_CONFLICT: MEMORY_CACHE_MESSAGES.instanceConflict,
				NOT_CONFIGURED: MEMORY_CACHE_MESSAGES.notConfigured,
				UPSTREAM_UNAVAILABLE: MEMORY_CACHE_MESSAGES.upstreamUnavailable,
			};
			const message = messages[code];
			return respond(status, memoryCacheErrorEnvelope(code, message));
		}
		return upstreamFail();
	}

	if (res.ok && envelope && "data" in envelope) {
		if (method === "GET" && !isOverviewData(envelope.data)) return upstreamFail();
		if (method === "POST" && !isMutationOkData(envelope.data)) return upstreamFail();
		return respond(200, { data: envelope.data });
	}

	return upstreamFail();
}

async function readRequestJson(request: Request): Promise<unknown | null> {
	let text: string;
	try {
		text = await readBoundedText(request, MAX_REQUEST_BODY_BYTES);
	} catch {
		return null;
	}
	try {
		return text ? JSON.parse(text) : null;
	} catch {
		return null;
	}
}

export const GET = createProxyHandler(async (request) => {
	const config = resolveUpstreamConfig();
	if (!config) {
		return fail("NOT_CONFIGURED", MEMORY_CACHE_MESSAGES.notConfigured);
	}
	const query = parseMemoryCacheQuery(new URL(request.url).searchParams);
	if (!query.ok) {
		return respond(
			MEMORY_CACHE_HTTP_STATUS.BAD_REQUEST,
			memoryCacheErrorEnvelope(query.error.code, query.error.message),
		);
	}
	const search = new URLSearchParams();
	if (query.value.family) search.set("family", query.value.family);
	search.set("page", String(query.value.page));
	search.set("limit", String(query.value.limit));
	return callUpstream(config, "GET", search);
});

export const POST = createProxyHandler(async (request) => {
	const config = resolveUpstreamConfig();
	if (!config) {
		return fail("NOT_CONFIGURED", MEMORY_CACHE_MESSAGES.notConfigured);
	}
	const body = await readRequestJson(request);
	const mutation = parseMemoryCacheMutation(body);
	if (!mutation.ok) {
		return respond(
			MEMORY_CACHE_HTTP_STATUS.BAD_REQUEST,
			memoryCacheErrorEnvelope(mutation.error.code, mutation.error.message),
		);
	}
	return callUpstream(config, "POST", new URLSearchParams(), JSON.stringify(mutation.value));
});
