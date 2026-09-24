import {
	HOME_CONTEXT_MAX_BODY_BYTES,
	HOME_MESSAGES,
	type HomeContextData,
	parseHomeContextRequest,
} from "@ellie/types";
import { loadPublicStats } from "../lib/cache/public-stats-read";
import type { Env } from "../lib/env";
import { loadHomeAuthority, loadHomeDisplay, loadHomeGates, loadHomeUser } from "../lib/home-read";
import { isTokenExpired, verifyJwt } from "../lib/jwt";
import { jsonNoStoreResponse } from "../lib/response";
import { errorResponse } from "../middleware/error";

interface JwtClaims {
	userId: number;
	role: number;
	exp: number;
}

/** POST /api/v1/home/context — read-only Key A, optional verified forum JWT. */
export async function homeContext(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	if (new URL(request.url).searchParams.size > 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: HOME_MESSAGES.unknownQuery }, origin);
	}
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: HOME_MESSAGES.invalidContentType },
			origin,
		);
	}
	const bytes = await readBoundedBody(request, HOME_CONTEXT_MAX_BODY_BYTES);
	if (!bytes) {
		return errorResponse("INVALID_REQUEST", 400, { message: HOME_MESSAGES.bodyTooLarge }, origin);
	}
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return errorResponse("INVALID_REQUEST", 400, { message: HOME_MESSAGES.invalidJson }, origin);
	}
	const parsed = parseHomeContextRequest(raw);
	if (!parsed.ok) {
		return errorResponse("INVALID_REQUEST", 400, { message: parsed.message }, origin);
	}

	const viewer = await verifiedViewer(request, env, origin);
	if (viewer instanceof Response) return viewer;
	const authority = await loadHomeAuthority(env, viewer);
	const includeDisplay =
		parsed.value.includeDisplay || parsed.value.cachedBucket !== authority.bucket;
	const sections: Promise<
		Awaited<ReturnType<typeof loadHomeDisplay>> | Awaited<ReturnType<typeof loadHomeGates>>
	> = includeDisplay
		? loadHomeDisplay(env, authority, parsed.value.summaryTopicIds, parsed.value.digestTopicIds)
		: loadHomeGates(env, authority, parsed.value.summaryTopicIds, parsed.value.digestTopicIds);
	const [loaded, stats] = await Promise.all([
		sections,
		parsed.value.includeStats
			? loadPublicStats(env).catch(() => {
					console.warn("[home-context] Statistics unavailable; omitted from response");
					return undefined;
				})
			: undefined,
	]);
	const data: HomeContextData = {
		bucket: authority.bucket,
		user: authority.user,
		allowedForumIds: authority.allowedForumIds,
		summaryGates: loaded.summaryGates,
		digestGates: loaded.digestGates,
	};
	if (includeDisplay && "forums" in loaded) {
		data.display = {
			forums: loaded.forums,
			summaries: loaded.summaries,
			digest: loaded.digest,
		};
	}
	if (stats) data.stats = stats;
	return jsonNoStoreResponse(data, origin);
}

async function verifiedViewer(
	request: Request,
	env: Env,
	origin: string | undefined,
): Promise<HomeContextData["user"] | Response> {
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
	const user = await loadHomeUser(env, claims.userId);
	return user;
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
