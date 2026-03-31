// Public settings handler — #12b GET /api/v1/settings
// Read-only endpoint returning typed settings map (KV-cached)

import type { Env } from "../lib/env";
import { jsonResponse } from "../lib/response";
import { type SettingsMap, getSettings } from "../lib/settings";

/**
 * #12b GET /api/v1/settings
 * Returns SettingsMap with typed values (numbers parsed, etc.).
 * Supports ?prefix= to filter by namespace.
 */
export async function list(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const prefix = url.searchParams.get("prefix");

	const all = await getSettings(env);

	if (prefix) {
		const filtered: SettingsMap = {};
		for (const [key, value] of Object.entries(all)) {
			if (key.startsWith(prefix)) {
				filtered[key] = value;
			}
		}
		return jsonResponse(filtered, origin);
	}

	return jsonResponse(all, origin);
}
