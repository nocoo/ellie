// Admin IP ban handlers — endpoints #47-#53
// Uses CRUD framework for getById, create, update, remove, batchDelete.
// Custom handlers for list (expired filter) and check-ip (CIDR/wildcard matching).

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import {
	createBatchDeleteHandler,
	createCreateHandler,
	createGetByIdHandler,
	createRemoveHandler,
	createUpdateHandler,
} from "../../lib/crud";
import type { Env } from "../../lib/env";
import { toIpBan } from "../../lib/mappers";
import { jsonResponse, paginatedResponse } from "../../lib/response";

import { errorResponse } from "../../middleware/error";

// ─── Column list ──────────────────────────────────────────────────

const IP_BAN_COLUMNS = "id, ip, admin_id, admin_name, reason, expires_at, created_at";

// ─── Entity Config ────────────────────────────────────────────────

const ipBanConfig: EntityConfig = {
	table: "ip_bans",
	entityName: "IP_BAN",
	auth: "admin",
	columns: IP_BAN_COLUMNS,
	mapper: toIpBan,
	notFoundCode: "IP_BAN_NOT_FOUND",

	// Filters defined for reference — list handler is custom
	filters: [{ param: "ip", column: "ip", type: "like" }],
	listSort: "id DESC",

	// #49 create fields
	createFields: [
		{
			name: "ip",
			column: "ip",
			required: true,
			validate: (v) => {
				if (typeof v !== "string") return "ip must be a string";
				if (v.trim().length === 0) return "ip cannot be empty";
				if (v.length > 45) return "ip must be at most 45 characters";
				return null;
			},
		},
		{
			name: "reason",
			column: "reason",
			default: "",
			validate: (v) => {
				if (typeof v !== "string") return "reason must be a string";
				if (v.length > 500) return "reason must be at most 500 characters";
				return null;
			},
		},
		{
			name: "expiresAt",
			column: "expires_at",
			default: null,
			validate: (v) => {
				if (v !== null && typeof v !== "number") return "expiresAt must be a number or null";
				return null;
			},
		},
	],

	// #50 update fields
	updateFields: [
		{
			name: "reason",
			column: "reason",
			validate: (v) => {
				if (typeof v !== "string") return "reason must be a string";
				if (v.length > 500) return "reason must be at most 500 characters";
				return null;
			},
		},
		{
			name: "expiresAt",
			column: "expires_at",
			validate: (v) => {
				if (v !== null && typeof v !== "number") return "expiresAt must be a number or null";
				return null;
			},
		},
	],

	canDelete: true,
	batchDelete: true,
	batchLimit: 100,

	// #49 beforeCreate: duplicate check, self-ban check, auto-fill admin fields
	beforeCreate: async (data, env, origin) => {
		// Check duplicate IP
		const existing = await env.DB.prepare("SELECT id FROM ip_bans WHERE ip = ?")
			.bind(data.ip)
			.first();
		if (existing) {
			return errorResponse("IP_BAN_DUPLICATE", 409, undefined, origin);
		}

		// Auto-fill admin fields (no user context in worker)
		data.admin_id = 0;
		data.admin_name = "System";

		// Auto-fill created_at
		data.created_at = Math.floor(Date.now() / 1000);

		return undefined;
	},
};

// ─── IP matching utilities ────────────────────────────────────────

/** Parse an IPv4 address to a 32-bit number. Returns null on invalid input. */
function ipv4ToNumber(ip: string): number | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	let num = 0;
	for (const part of parts) {
		const octet = Number.parseInt(part, 10);
		if (Number.isNaN(octet) || octet < 0 || octet > 255) return null;
		num = (num << 8) | octet;
	}
	return num >>> 0; // unsigned
}

/** Check if an IP matches a CIDR range (e.g., 192.168.0.0/24). */
function matchesCidr(ip: string, cidr: string): boolean {
	const [base, prefixStr] = cidr.split("/");
	if (!base || !prefixStr) return false;
	const prefix = Number.parseInt(prefixStr, 10);
	if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;

	const ipNum = ipv4ToNumber(ip);
	const baseNum = ipv4ToNumber(base);
	if (ipNum === null || baseNum === null) return false;

	const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
	return (ipNum & mask) === (baseNum & mask);
}

/** Check if an IP matches a wildcard pattern (e.g., 10.0.*.*). */
function matchesWildcard(ip: string, pattern: string): boolean {
	const ipParts = ip.split(".");
	const patternParts = pattern.split(".");
	if (ipParts.length !== 4 || patternParts.length !== 4) return false;

	for (let i = 0; i < 4; i++) {
		if (patternParts[i] === "*") continue;
		if (ipParts[i] !== patternParts[i]) return false;
	}
	return true;
}

/** Check if a stored rule matches a given IP (exact, CIDR, or wildcard). */
function ipMatchesRule(inputIp: string, ruleIp: string): boolean {
	// Exact match
	if (ruleIp === inputIp) return true;
	// CIDR match
	if (ruleIp.includes("/")) return matchesCidr(inputIp, ruleIp);
	// Wildcard match
	if (ruleIp.includes("*")) return matchesWildcard(inputIp, ruleIp);
	return false;
}

/**
 * Classify a rule IP for specificity ranking.
 * Higher specificity = more specific rule = should take priority.
 * - exact: specificity 1000 (most specific)
 * - CIDR: specificity = prefix length (0–32, higher = more specific)
 * - wildcard: specificity = number of non-wildcard octets (0–3)
 */
function ruleSpecificity(ruleIp: string): number {
	// CIDR
	if (ruleIp.includes("/")) {
		const prefixStr = ruleIp.split("/")[1];
		const prefix = Number.parseInt(prefixStr ?? "0", 10);
		// CIDR /32 is effectively exact but still less than a true exact match
		return Number.isNaN(prefix) ? 0 : prefix;
	}
	// Wildcard
	if (ruleIp.includes("*")) {
		const parts = ruleIp.split(".");
		const nonWild = parts.filter((p) => p !== "*").length;
		return nonWild; // 0–3, always less than CIDR /8 = 8
	}
	// Exact match (no / or *)
	return 1000;
}

// ─── #47 GET /api/admin/ip-bans ───────────────────────────────────
// Custom list handler: supports ip (LIKE) filter + expired toggle.
// By default only returns valid (non-expired) bans.

export const list = withEntityAuth(
	ipBanConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);

		const conditions: string[] = [];
		const params: unknown[] = [];

		// Filter: ip (LIKE)
		const ipFilter = url.searchParams.get("ip");
		if (ipFilter) {
			conditions.push("ip LIKE ?");
			params.push(`%${ipFilter}%`);
		}

		// Filter: expired — by default exclude expired bans
		const includeExpired = url.searchParams.get("expired") === "true";
		if (!includeExpired) {
			conditions.push("(expires_at IS NULL OR expires_at > ?)");
			params.push(Math.floor(Date.now() / 1000));
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		// Pagination
		const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
		const limit = Math.min(
			Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10), 1),
			100,
		);
		if (page < 1 || Number.isNaN(page)) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid page number" }, origin);
		}

		const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM ip_bans ${whereClause}`)
			.bind(...params)
			.first<{ total: number }>();

		const result = await env.DB.prepare(
			`SELECT ${IP_BAN_COLUMNS} FROM ip_bans ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
		)
			.bind(...params, limit, (page - 1) * limit)
			.all();

		return paginatedResponse(
			result.results.map((r) => toIpBan(r as Record<string, unknown>)),
			countResult?.total ?? 0,
			page,
			limit,
			origin,
		);
	},
);

// ─── #48 GET /api/admin/ip-bans/:id ──────────────────────────────

export const getById = withEntityAuth(ipBanConfig, createGetByIdHandler(ipBanConfig));

// ─── #49 POST /api/admin/ip-bans ─────────────────────────────────
// Self-ban check wraps the CRUD create handler.

const crudCreate = createCreateHandler(ipBanConfig);

export const create = withEntityAuth(
	ipBanConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		// Clone body to peek at the IP for self-ban check
		const cloned = request.clone();
		let body: Record<string, unknown>;
		try {
			body = (await cloned.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		// Self-ban check: compare with CF-Connecting-IP (or fallback headers)
		const requestIp =
			request.headers.get("CF-Connecting-IP") ??
			request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
			null;
		if (requestIp && typeof body.ip === "string" && ipMatchesRule(requestIp, body.ip)) {
			return errorResponse("IP_BAN_SELF", 400, undefined, origin);
		}

		return crudCreate(request, env);
	},
);

// ─── #50 PATCH /api/admin/ip-bans/:id ────────────────────────────

export const update = withEntityAuth(ipBanConfig, createUpdateHandler(ipBanConfig));

// ─── #51 DELETE /api/admin/ip-bans/:id ───────────────────────────

export const remove = withEntityAuth(ipBanConfig, createRemoveHandler(ipBanConfig));

// ─── #52 POST /api/admin/ip-bans/batch-delete ────────────────────

export const batchDelete = withEntityAuth(ipBanConfig, createBatchDeleteHandler(ipBanConfig));

// ─── #53 GET /api/admin/ip-bans/check-ip ─────────────────────────

export const checkIp = withEntityAuth(
	ipBanConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);

		const ip = url.searchParams.get("ip");
		if (!ip) {
			return errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: "ip query parameter is required" },
				origin,
			);
		}

		// Fetch all valid (non-expired) bans
		const now = Math.floor(Date.now() / 1000);
		const result = await env.DB.prepare(
			`SELECT ${IP_BAN_COLUMNS} FROM ip_bans WHERE expires_at IS NULL OR expires_at > ?`,
		)
			.bind(now)
			.all();

		// Collect all matching rules
		const matches: { ban: Record<string, unknown>; specificity: number }[] = [];
		for (const row of result.results) {
			const ban = row as Record<string, unknown>;
			const ruleIp = ban.ip as string;
			if (ipMatchesRule(ip, ruleIp)) {
				matches.push({ ban, specificity: ruleSpecificity(ruleIp) });
			}
		}

		if (matches.length === 0) {
			return jsonResponse({ banned: false }, origin);
		}

		// Sort by specificity descending — most specific rule first
		matches.sort((a, b) => b.specificity - a.specificity);

		return jsonResponse({ banned: true, matchedRule: toIpBan(matches[0].ban) }, origin);
	},
);
