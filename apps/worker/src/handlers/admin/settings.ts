// Admin settings handler — #62 GET, #63 PUT /api/admin/settings
// Custom handler (not CRUD factory) — settings use "get all + bulk update" pattern

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
import { type SettingsDetailMap, getSettingsDetailed, upsertSettings } from "../../lib/settings";
import { errorResponse } from "../../middleware/error";

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
	// general.og
	"general.og.title",
	"general.og.description",
	"general.og.site_name",
	"general.og.image",
	"general.og.url",
	"general.og.twitter_card",
	"general.og.twitter_site",
	// general.pagination
	"general.pagination.page_size",
	"general.pagination.posts_per_page",
	"general.pagination.max_post_length",
	// general.navigation
	"general.navigation.header_links",
	"general.navigation.friend_links",
	// features.registration — registration control
	"features.registration.allow_new_user",
	// features.access — access control
	"features.access.require_login",
	"features.access.maintenance_mode",
	"features.access.maintenance_message",
	"features.access.maintenance_admin_bypass",
	// features.content — content controls
	"features.content.allow_new_thread",
	"features.content.allow_reply",
	// features.posting — new user posting restrictions
	"features.posting.enabled",
	"features.posting.min_registration_days",
	// Note: features.posting.require_email_verified is reserved for future use
	// when email verification is implemented. Not in whitelist to prevent false security.
	"features.posting.require_avatar",
]);

/** Keys that must have positive numeric values */
const NUMBER_KEYS = new Set([
	"general.pagination.page_size",
	"general.pagination.posts_per_page",
	"general.pagination.max_post_length",
]);

/** Keys that must have non-negative numeric values (0 allowed) */
const NUMBER_KEYS_ALLOW_ZERO = new Set(["features.posting.min_registration_days"]);

/** Keys that must be "true" or "false" */
const BOOLEAN_KEYS = new Set([
	"features.access.require_login",
	"features.access.maintenance_mode",
	"features.access.maintenance_admin_bypass",
	"features.content.allow_new_thread",
	"features.content.allow_reply",
	"features.posting.enabled",
	"features.posting.require_avatar",
]);

/** Keys that must be valid JSON with specific structure */
const JSON_KEYS = new Set(["general.navigation.header_links", "general.navigation.friend_links"]);

/**
 * Validate that a value is a JSON array of { label: string, url: string } objects.
 */
function isValidNavLinksJson(value: string): boolean {
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return false;
		return parsed.every(
			(item: unknown) =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as Record<string, unknown>).label === "string" &&
				typeof (item as Record<string, unknown>).url === "string",
		);
	} catch {
		return false;
	}
}

// ─── Validation helpers ─────────────────────────────────────

type ValidationResult =
	| { valid: true }
	| { valid: false; error: string; details?: Record<string, unknown> };

function validateEntries(entries: [string, string][]): ValidationResult {
	// Validate keys against whitelist
	const unknownKeys = entries.filter(([key]) => !ALLOWED_KEYS.has(key)).map(([key]) => key);
	if (unknownKeys.length > 0) {
		return { valid: false, error: "UNKNOWN_KEYS", details: { keys: unknownKeys } };
	}

	// Validate all entry values
	for (const [key, value] of entries) {
		const result = validateEntryValue(key, value);
		if (!result.valid) return result;
	}

	return { valid: true };
}

function validateEntryValue(key: string, value: string): ValidationResult {
	// Validate positive number keys
	if (NUMBER_KEYS.has(key)) {
		const num = Number(value);
		if (Number.isNaN(num) || num <= 0) {
			return { valid: false, error: "INVALID_NUMBER", details: { key, value } };
		}
	}

	// Validate non-negative number keys
	if (NUMBER_KEYS_ALLOW_ZERO.has(key)) {
		const num = Number(value);
		if (Number.isNaN(num) || num < 0 || !Number.isInteger(num)) {
			return { valid: false, error: "INVALID_NUMBER", details: { key, value } };
		}
	}

	// Validate boolean keys
	if (BOOLEAN_KEYS.has(key)) {
		if (value !== "true" && value !== "false") {
			return { valid: false, error: "INVALID_BOOLEAN", details: { key, value } };
		}
	}

	// Validate JSON keys
	if (JSON_KEYS.has(key)) {
		if (!isValidNavLinksJson(value)) {
			return { valid: false, error: "INVALID_JSON_VALUE", details: { key } };
		}
	}

	return { valid: true };
}

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
		return jsonNoStoreResponse(filtered, origin);
	}

	return jsonNoStoreResponse(all, origin);
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

	// Validate all entries
	const validation = validateEntries(entries);
	if (!validation.valid) {
		return errorResponse(validation.error, 400, validation.details, origin);
	}

	// Convert entries to Record<string, string>
	const updateMap: Record<string, string> = {};
	for (const [key, value] of entries) {
		updateMap[key] = String(value);
	}

	// Snapshot prior values so audit can record the diff. Done after validation
	// so we never log keys the operator can't actually write. Best-effort: a
	// failure here just degrades the diff to changedKeys-only.
	let priorMap: SettingsDetailMap = {};
	try {
		priorMap = await getSettingsDetailed(env);
	} catch {
		// fall through with {}
	}

	await upsertSettings(env, updateMap);

	// F3-c: classify each changed key and redact suspected secrets so audit
	// rows never carry credentials. The exact-match denylist in adminLog only
	// catches bare `password`/`token`/...; settings keys are dotted/prefixed
	// (e.g. `general.smtp.password`) so we apply our own substring rules here
	// and only emit `[REDACTED]` envelopes for sensitive keys.
	const changedKeys: string[] = [];
	const valuesBefore: Record<string, string | null> = {};
	const valuesAfter: Record<string, string | null> = {};
	for (const [key, value] of entries) {
		const prior = priorMap[key]?.value ?? null;
		const next = String(value);
		// String-equality skip — settings values are stored/compared as strings.
		if (prior === next) continue;
		changedKeys.push(key);
		if (isSensitiveSettingsKey(key)) {
			valuesBefore[key] = prior === null ? null : "[REDACTED]";
			valuesAfter[key] = "[REDACTED]";
		} else {
			valuesBefore[key] = prior;
			valuesAfter[key] = next;
		}
	}

	if (changedKeys.length > 0) {
		await writeAdminLog(env, resolveActor(request, env), {
			action: "setting.update",
			targetType: "setting",
			targetId: null,
			details: {
				count: changedKeys.length,
				changedKeys,
				before: valuesBefore,
				after: valuesAfter,
			},
		});
	}

	return jsonNoStoreResponse({ updated: entries.length }, origin);
}

// ─── Audit helpers ──────────────────────────────────────────
// Substring-based sensitive key detector. Setting keys are dotted (e.g.
// `general.smtp.password`, `general.oauth.client_secret`) so the exact-match
// denylist in `sanitizeAdminLogDetails` would not catch them — we apply our
// own classification here before details ever reach the sanitizer. False
// positives (e.g. `general.smtp.username` doesn't trigger) are preferred to
// false negatives.

const SENSITIVE_KEY_SUBSTRINGS = [
	"password",
	"secret",
	"token",
	"api_key",
	"apikey",
	"api-key",
	"cookie",
	"auth",
	"credential",
	"private_key",
];

function isSensitiveSettingsKey(key: string): boolean {
	const lower = key.toLowerCase();
	return SENSITIVE_KEY_SUBSTRINGS.some((needle) => lower.includes(needle));
}

// ─── Exports (wrapped with withEntityAuth) ──────────────────

export const list = withEntityAuth(settingsConfig, listSettings);
export const bulkUpdate = withEntityAuth(settingsConfig, bulkUpdateSettings);
