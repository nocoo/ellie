/**
 * Server-only Next.js route-handler proxy for the Worker forum API.
 *
 * Phase C (route-layer abstraction): collapses the boilerplate that was
 * being repeated across `apps/web/src/app/api/v1/**\/route.ts` —
 * Origin/Referer CSRF gate, NextAuth → Worker JWT acquisition,
 * `forumApi.<verb>` forwarding, `ForumApiError` translation,
 * unknown-error 500. Routes that fit this shape become a single
 * `proxyRoute(...)` declaration.
 *
 * Scope is intentionally conservative for the first batch:
 *   - `auth`: `"required"` (default) | `"none"`. The optional-auth
 *     fallback used by `forums/route.ts` and `users/[id]/route.ts` is
 *     NOT supported here yet — those routes stay hand-written.
 *   - `body`: must be declared explicitly for non-GET methods. No
 *     auto-detection from the HTTP method, so a PATCH-with-empty-body
 *     and a POST-with-JSON-body cannot accidentally swap shapes.
 *   - `query`: pass-through `URLSearchParams` to a flat `Record<string,
 *     string>` (the shape `forumApi.get*` already accepts). Empty
 *     search yields `undefined` — no key is added. We do not invent
 *     repeat-key semantics.
 *   - `csrf`: defaults to `"auto"` (mutating methods are gated). Can
 *     be forced or disabled.
 *   - `successStatus`: lets POST routes that semantically create a
 *     resource keep their existing 201 status.
 *   - `transform` / `onForumApiError` are exposed for future-batch
 *     migrations of routes with non-standard response/error shaping.
 *     The first batch never sets them, so the defaults are the
 *     contract under test.
 *
 * This file is the ONLY allowed home for `forumApi.*` /
 * `getWorkerJwt` / CSRF / proxy-error wiring inside
 * `apps/web/src/app/api/v1/**\/route.ts` — enforced by a Phase C
 * architecture guard. New route handlers must go through here unless
 * they appear on the guard's documented allowlist.
 */

import "server-only";

import { type NextRequest, NextResponse } from "next/server";
import { extractClientIp } from "@/lib/client-ip";
import { isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { type ClientContext, ForumApiError, forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApiErrorToProxyResponse } from "@/lib/proxy-error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProxyVerb = "GET" | "POST" | "PATCH" | "DELETE";

export type ProxyAuthMode = "required" | "none";

export type ProxyCsrfMode = "auto" | "always" | "never";

/** Body strategy for non-GET methods. */
export type ProxyBodyMode = "json" | "empty" | ((req: Request) => Promise<unknown>);

/** Query-string strategy for GET methods. */
export type ProxyQueryMode = "passthrough" | "none" | readonly string[];

export interface ProxyRouteOptions<P> {
	method: ProxyVerb;
	/** Worker path (under `/api/v1/...`). May derive from route params. */
	path: (params: P) => string;
	/** Default `"required"`. `"none"` calls the unauthenticated `forumApi.get` for GET. */
	auth?: ProxyAuthMode;
	/** Default `"auto"` — mutating methods (non-GET/HEAD) are CSRF-gated. */
	csrf?: ProxyCsrfMode;
	/**
	 * Required for non-GET methods. `"json"` reads `request.json()`,
	 * `"empty"` forwards `{}`, function escape hatch for special bodies.
	 */
	body?: ProxyBodyMode;
	/** GET only. Default `"passthrough"`. */
	query?: ProxyQueryMode;
	/** Default 200. Set 201 for create endpoints. */
	successStatus?: number;
	/** Future-batch hook; default identity. */
	transform?: (result: unknown) => unknown;
	/** Future-batch hook; default `forumApiErrorToProxyResponse`. */
	onForumApiError?: (err: ForumApiError) => Response;
	/** Diagnostic tag in console.error. Defaults to the templated path. */
	debugTag?: string;
}

export type ProxyRouteHandler<P> = (
	request: NextRequest,
	ctx: { params: Promise<P> },
) => Promise<Response>;

// ---------------------------------------------------------------------------
// Error helpers (private)
// ---------------------------------------------------------------------------

function csrfRejected(): Response {
	return NextResponse.json(
		{ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } },
		{ status: 403 },
	);
}

function notAuthenticated(): Response {
	return NextResponse.json(
		{ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
		{ status: 401 },
	);
}

function internalError(): Response {
	return NextResponse.json(
		{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
		{ status: 500 },
	);
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

function csrfBlocks(request: Request, mode: ProxyCsrfMode): boolean {
	if (mode === "never") return false;
	const required = mode === "always" || isMutatingMethod(request.method);
	if (!required) return false;
	return !validateOrigin(request);
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

type FlatQuery = Record<string, string>;

function pickQuery(request: NextRequest, mode: ProxyQueryMode): FlatQuery | undefined {
	if (mode === "none") return undefined;
	const sp = request.nextUrl.searchParams;
	if (mode === "passthrough") {
		const out: FlatQuery = {};
		let any = false;
		sp.forEach((value, key) => {
			// Last-wins on duplicate keys — matches `Object.fromEntries`
			// behavior used by hand-written routes today; we don't invent
			// repeat-key semantics in this helper.
			out[key] = value;
			any = true;
		});
		return any ? out : undefined;
	}
	const allowed: FlatQuery = {};
	let any = false;
	for (const key of mode) {
		const v = sp.get(key);
		if (v !== null) {
			allowed[key] = v;
			any = true;
		}
	}
	return any ? allowed : undefined;
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

async function readBody(request: Request, mode: ProxyBodyMode): Promise<unknown> {
	if (mode === "empty") return {};
	if (mode === "json") return request.json();
	return mode(request);
}

// ---------------------------------------------------------------------------
// Worker dispatch
// ---------------------------------------------------------------------------

interface DispatchInput {
	method: ProxyVerb;
	path: string;
	jwt: string | null;
	body: unknown;
	query: FlatQuery | undefined;
	client: ClientContext;
}

async function dispatch(input: DispatchInput): Promise<unknown> {
	const { method, path, jwt, body, query, client } = input;
	if (method === "GET") {
		if (jwt) return forumApi.getAuth<unknown>(path, jwt, query, client);
		return forumApi.get<unknown>(path, query);
	}
	if (!jwt) throw new Error("dispatch: missing jwt for non-GET verb");
	if (method === "POST") return forumApi.postAuth<unknown>(path, body, jwt, client);
	if (method === "PATCH") return forumApi.patchAuth<unknown>(path, body, jwt, client);
	return forumApi.deleteAuth<unknown>(path, body, jwt, client);
}

// ---------------------------------------------------------------------------
// Validation (option sanity)
// ---------------------------------------------------------------------------

function validateOptions<P>(opts: ProxyRouteOptions<P>): void {
	if (opts.method === "GET") {
		if (opts.body !== undefined) {
			throw new Error("proxyRoute: GET handlers must not declare a body strategy");
		}
	} else {
		if (opts.body === undefined) {
			throw new Error(
				`proxyRoute: ${opts.method} handlers must declare body: "json" | "empty" | fn`,
			);
		}
		if (opts.query !== undefined) {
			throw new Error("proxyRoute: query is only valid for GET handlers");
		}
	}
	if (opts.auth === "none" && opts.method !== "GET") {
		throw new Error('proxyRoute: auth: "none" is only supported for GET in this batch');
	}
}

// ---------------------------------------------------------------------------
// Client context
// ---------------------------------------------------------------------------

function buildClientContext(request: NextRequest): ClientContext {
	return {
		ip: extractClientIp(request) || undefined,
		userAgent: request.headers.get("User-Agent") || undefined,
	};
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function proxyRoute<P>(opts: ProxyRouteOptions<P>): ProxyRouteHandler<P> {
	validateOptions(opts);

	const auth = opts.auth ?? "required";
	const csrf = opts.csrf ?? "auto";
	const query = opts.query ?? (opts.method === "GET" ? "passthrough" : "none");
	const successStatus = opts.successStatus ?? 200;
	const transform = opts.transform ?? ((x: unknown) => x);
	const onForumApiError = opts.onForumApiError ?? forumApiErrorToProxyResponse;

	return async function handler(request, ctx) {
		// 1. CSRF
		if (csrfBlocks(request, csrf)) return csrfRejected();

		// 2. Extract client context for Worker forwarding
		const client = buildClientContext(request);

		// 3. Auth
		let jwt: string | null = null;
		if (auth === "required") {
			try {
				jwt = await getWorkerJwt();
			} catch (err) {
				console.error(`[proxyRoute:${opts.debugTag ?? opts.method}] getWorkerJwt error:`, err);
				return internalError();
			}
			if (!jwt) return notAuthenticated();
		}

		// 4. Resolve dynamic path
		const params = await ctx.params;
		const path = opts.path(params);

		// 5. Body / query
		let body: unknown;
		if (opts.method !== "GET") {
			try {
				body = await readBody(request, opts.body as ProxyBodyMode);
			} catch (err) {
				console.error(`[proxyRoute:${opts.debugTag ?? path}] body parse error:`, err);
				return NextResponse.json(
					{ error: { code: "BAD_REQUEST", message: "Invalid request body" } },
					{ status: 400 },
				);
			}
		}
		const flatQuery = opts.method === "GET" ? pickQuery(request, query) : undefined;

		// 6. Dispatch + error mapping
		try {
			const result = await dispatch({
				method: opts.method,
				path,
				jwt,
				body,
				query: flatQuery,
				client,
			});
			return NextResponse.json(transform(result), { status: successStatus });
		} catch (err) {
			if (err instanceof ForumApiError) return onForumApiError(err);
			console.error(`[proxyRoute:${opts.debugTag ?? path}] forumApi error:`, err);
			return internalError();
		}
	};
}
