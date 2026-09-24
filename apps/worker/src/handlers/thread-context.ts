import {
	type HomeUser,
	parseThreadDetailContextRequest,
	THREAD_DETAIL_MAX_BODY_BYTES,
	THREAD_DETAIL_MESSAGES,
} from "@ellie/types";
import type { Env } from "../lib/env";
import { loadHomeUser } from "../lib/home-read";
import { isTokenExpired, verifyJwt } from "../lib/jwt";
import { jsonNoStoreResponse } from "../lib/response";
import {
	readThreadDetailContext,
	ThreadDetailAccessError,
	ThreadDetailBoundError,
} from "../lib/thread-detail-read";
import { errorResponse } from "../middleware/error";

interface JwtClaims {
	userId: number;
	role: number;
	exp: number;
}

/** POST /api/v1/threads/context — read-only Key A, optional verified forum JWT. */
export async function threadContext(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	if (new URL(request.url).searchParams.size > 0) {
		return noStore(
			errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: THREAD_DETAIL_MESSAGES.unknownQuery },
				origin,
			),
		);
	}
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
		return noStore(
			errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: THREAD_DETAIL_MESSAGES.invalidContentType },
				origin,
			),
		);
	}
	const bytes = await readBoundedBody(request, THREAD_DETAIL_MAX_BODY_BYTES);
	if (!bytes) {
		return noStore(
			errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: THREAD_DETAIL_MESSAGES.bodyTooLarge },
				origin,
			),
		);
	}
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return noStore(
			errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: THREAD_DETAIL_MESSAGES.invalidJson },
				origin,
			),
		);
	}
	const parsed = parseThreadDetailContextRequest(raw);
	if (!parsed.ok) {
		return noStore(errorResponse("INVALID_REQUEST", 400, { message: parsed.message }, origin));
	}
	const viewer = await verifiedViewer(request, env, origin);
	if (viewer instanceof Response) return noStore(viewer);
	try {
		return jsonNoStoreResponse(await readThreadDetailContext(env, viewer, parsed.value), origin);
	} catch (err) {
		if (err instanceof ThreadDetailAccessError) {
			return noStore(
				errorResponse(
					err.status === 403 ? "FORBIDDEN" : "THREAD_NOT_FOUND",
					err.status,
					err.status === 403 ? { message: "You don't have access to this thread" } : undefined,
					origin,
				),
			);
		}
		if (err instanceof ThreadDetailBoundError) {
			return noStore(errorResponse("SERVICE_UNAVAILABLE", 503, { message: err.message }, origin));
		}
		throw err;
	}
}

function noStore(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("Cache-Control", "no-store, private");
	return new Response(response.body, { status: response.status, headers });
}

async function verifiedViewer(
	request: Request,
	env: Env,
	origin: string | undefined,
): Promise<HomeUser | null | Response> {
	const header = request.headers.get("Authorization");
	if (header === null) return null;
	if (!header.startsWith("Bearer ")) {
		return errorResponse("INVALID_TOKEN", 401, undefined, origin);
	}
	const token = header.slice("Bearer ".length);
	if (!token) return errorResponse("INVALID_TOKEN", 401, undefined, origin);
	let claims: JwtClaims;
	try {
		claims = (await verifyJwt(token, env.JWT_SECRET)) as JwtClaims;
	} catch {
		return errorResponse("INVALID_TOKEN", 401, undefined, origin);
	}
	if (isTokenExpired(claims) || !Number.isSafeInteger(claims.userId) || claims.userId <= 0) {
		return errorResponse(
			isTokenExpired(claims) ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
			401,
			undefined,
			origin,
		);
	}
	return loadHomeUser(env, claims.userId);
}

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array | null> {
	const declared = request.headers.get("content-length");
	if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) return null;
	const body = request.body;
	if (!body) return new Uint8Array();
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
				return null;
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
	return bytes;
}
