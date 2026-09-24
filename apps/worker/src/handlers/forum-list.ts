import {
	FORUM_LIST_MAX_BODY_BYTES,
	type ForumListContextData,
	type HomeUser,
	parseForumListContextRequest,
} from "@ellie/types";
import type { Env } from "../lib/env";
import {
	FORUM_LIST_RESPONSE_MAX_BYTES,
	ForumListAccessError,
	ForumListBoundError,
	readForumListContext,
} from "../lib/forum-list-read";
import { loadHomeUser } from "../lib/home-read";
import { isTokenExpired, verifyJwt } from "../lib/jwt";
import { buildJsonHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

interface JwtClaims {
	userId: number;
	role: number;
	exp: number;
}

/** POST /api/v1/forums/context — read-only Key A, optional verified forum JWT. */
export async function forumListContext(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	if (new URL(request.url).searchParams.size > 0) {
		return noStore(
			errorResponse("INVALID_REQUEST", 400, { message: "Unknown query parameter" }, origin),
		);
	}
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
		return noStore(
			errorResponse("INVALID_REQUEST", 400, { message: "Invalid content type" }, origin),
		);
	}
	const bytes = await readBoundedBody(request, FORUM_LIST_MAX_BODY_BYTES);
	if (!bytes) {
		return noStore(
			errorResponse("INVALID_REQUEST", 400, { message: "Request body too large" }, origin),
		);
	}
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return noStore(errorResponse("INVALID_REQUEST", 400, { message: "Invalid JSON" }, origin));
	}
	const parsed = parseForumListContextRequest(raw);
	if (!parsed.ok) {
		return noStore(errorResponse("INVALID_REQUEST", 400, { message: parsed.message }, origin));
	}
	const viewer = await verifiedViewer(request, env, origin);
	if (viewer instanceof Response) return noStore(viewer);
	try {
		const data = await readForumListContext(env, viewer, parsed.value);
		return boundedNoStore(data, origin);
	} catch (err) {
		if (err instanceof ForumListAccessError) {
			return noStore(
				errorResponse(
					err.status === 403 ? "FORBIDDEN" : "FORUM_NOT_FOUND",
					err.status,
					undefined,
					origin,
				),
			);
		}
		if (err instanceof ForumListBoundError) {
			return noStore(errorResponse("SERVICE_UNAVAILABLE", 503, { message: err.message }, origin));
		}
		throw err;
	}
}

function boundedNoStore(data: ForumListContextData, origin: string | undefined): Response {
	const body = JSON.stringify({
		data,
		meta: { timestamp: Date.now(), requestId: crypto.randomUUID() },
	});
	if (new TextEncoder().encode(body).byteLength > FORUM_LIST_RESPONSE_MAX_BYTES) {
		return noStore(
			errorResponse(
				"SERVICE_UNAVAILABLE",
				503,
				{ message: "Forum list context exceeds its response bound" },
				origin,
			),
		);
	}
	const headers = buildJsonHeaders(origin);
	headers["Cache-Control"] = "no-store, private";
	return new Response(body, { status: 200, headers });
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
