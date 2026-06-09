// Public settings handler — #12b GET /api/v1/settings
// Read-only endpoint returning typed settings map (KV-cached)
// Security: Only returns safe public prefixes to avoid operational disclosure

import type { Env } from "../lib/env";
import { jsonResponse } from "../lib/response";
import { getSettings, type SettingsMap } from "../lib/settings";

/**
 * Prefixes that are safe to expose publicly.
 *
 * SECURITY: Only include prefixes that don't leak sensitive operational info.
 * - features.access.*: Access control flags (require_login, maintenance_mode)
 *   These must be public so the frontend can enforce access restrictions.
 * - features.content.*: Content creation toggles (allow_new_thread, allow_reply)
 *   These control UI visibility, not security.
 *
 * NOT included (sensitive):
 * - features.registration.*: Leaks registration policy
 * - features.posting.*: Leaks anti-spam/quality thresholds
 */
const PUBLIC_SAFE_PREFIXES = [
	"general.site.", // Site name, subtitle, copyright
	"general.og.", // Open Graph metadata
	"general.pagination.", // Pagination settings
	"general.navigation.", // Header/footer links
	"general.search.", // Search feature toggle (enabled/disabled)
	"features.access.", // Access control (require_login, maintenance_mode, etc.)
	"features.content.", // Content creation toggles (allow_new_thread, allow_reply)
];

/**
 * #12b GET /api/v1/settings
 * Returns SettingsMap with typed values (numbers parsed, etc.).
 *
 * Security: Only returns settings with safe public prefixes.
 * Use ?prefix= to filter (must still be within safe prefixes).
 */
export async function list(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const requestedPrefix = url.searchParams.get("prefix");

	const all = await getSettings(env);
	const filtered: SettingsMap = {};

	for (const [key, value] of Object.entries(all)) {
		// Only include keys that start with a safe public prefix
		const isSafePrefix = PUBLIC_SAFE_PREFIXES.some((safe) => key.startsWith(safe));
		if (!isSafePrefix) {
			continue;
		}

		// If a specific prefix was requested, also filter by that
		if (requestedPrefix && !key.startsWith(requestedPrefix)) {
			continue;
		}

		filtered[key] = value;
	}

	return jsonResponse(filtered, origin);
}
