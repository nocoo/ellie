// Admin settings handler — #62 GET, #63 PUT /api/admin/settings
// Custom handler (not CRUD factory) — settings use "get all + bulk update" pattern

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";
import {
	type SettingsDetailMap,
	getSettingsDetailed,
	upsertSettings,
} from "../../lib/settings";

// ─── Config (for withEntityAuth pattern consistency) ─────────

const settingsConfig: EntityConfig = {
	table: "settings",
	entityName: "SETTINGS",
	auth: "admin",
	columns: "",
	mapper: (row) => row,
};

// ─── Allowed keys whitelist ─────────────────────────────────

const ALLOWED_KEYS = new Set([
	// general.site
	"general.site.name",
	"general.site.subtitle",
	"general.site.copyright",
	"general.site.powered_by",
	"general.site.version",
	// general.og
	"general.og.title",
	"general.og.description",
	"general.og.site_name",
	"general.og.image",
	"general.og.url",
	"general.og.twitter_card",
	"general.og.twitter_site",
	// general.pagination
	"general.pagination.threads_per_page",
	"general.pagination.posts_per_page",
	"general.pagination.user_history_per_page",
	"general.pagination.max_post_length",
	"general.pagination.admin_page_size",
	// general.assets
	"general.assets.avatar_cdn_base",
]);

/** Keys that must have positive numeric values */
const NUMBER_KEYS = new Set([
	"general.pagination.threads_per_page",
	"general.pagination.posts_per_page",
	"general.pagination.user_history_per_page",
	"general.pagination.max_post_length",
	"general.pagination.admin_page_size",
]);

// ─── Handlers ───────────────────────────────────────────────

/**
 * #62 GET /api/admin/settings
 * Returns SettingsDetailMap with type/updatedAt metadata.
 * Supports ?prefix= to filter by namespace.
 */
async function listSettings(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const prefix = url.searchParams.get("prefix");

	const all = await getSettingsDetailed(env);

	if (prefix) {
		const filtered: SettingsDetailMap = {};
		for (const [key, entry] of Object.entries(all)) {
			if (key.startsWith(prefix)) {
				filtered[key] = entry;
			}
		}
		return jsonResponse(filtered, origin);
	}

	return jsonResponse(all, origin);
}

/**
 * #63 PUT /api/admin/settings
 * Accepts { "key": "value", ... } and bulk updates.
 * Validates against ALLOWED_KEYS whitelist and number constraints.
 */
async function bulkUpdateSettings(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, string>;
	try {
		body = (await request.json()) as Record<string, string>;
	} catch {
		return errorResponse("INVALID_JSON", 400, undefined, origin);
	}

	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const entries = Object.entries(body);
	if (entries.length === 0) {
		return errorResponse("EMPTY_PAYLOAD", 400, undefined, origin);
	}

	// Validate keys against whitelist
	const unknownKeys = entries.filter(([key]) => !ALLOWED_KEYS.has(key)).map(([key]) => key);
	if (unknownKeys.length > 0) {
		return errorResponse("UNKNOWN_KEYS", 400, { keys: unknownKeys }, origin);
	}

	// Validate number keys are positive
	for (const [key, value] of entries) {
		if (NUMBER_KEYS.has(key)) {
			const num = Number(value);
			if (Number.isNaN(num) || num <= 0) {
				return errorResponse("INVALID_NUMBER", 400, { key, value }, origin);
			}
		}
	}

	// Convert entries to Record<string, string>
	const updateMap: Record<string, string> = {};
	for (const [key, value] of entries) {
		updateMap[key] = String(value);
	}

	await upsertSettings(env, updateMap);

	return jsonResponse({ updated: entries.length }, origin);
}

// ─── Exports (wrapped with withEntityAuth) ──────────────────

export const list = withEntityAuth(settingsConfig, listSettings);
export const bulkUpdate = withEntityAuth(settingsConfig, bulkUpdateSettings);
