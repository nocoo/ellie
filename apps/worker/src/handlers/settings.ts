// Public settings handler — #12b GET /api/v1/settings
// Read-only endpoint returning typed settings map (KV-cached)
// Security: Only returns safe public prefixes to avoid operational disclosure

import type { Env } from "../lib/env";
import { jsonResponse } from "../lib/response";
import { type SettingsMap, getSettings } from "../lib/settings";

/**
 * Prefixes that are safe to expose publicly.
 * Operational/security settings (features.*, etc.) are NOT included.
 */
const PUBLIC_SAFE_PREFIXES = [
	"general.site.", // Site name, subtitle, copyright
	"general.og.", // Open Graph metadata
	"general.pagination.", // Pagination settings
	"general.navigation.", // Header/footer links
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
