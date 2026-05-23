/**
 * Pure public-settings loader (unwrapped).
 *
 * Phase B: this is a pure-loader only. RSC render-pass dedupe is handled
 * by `lib/forum-cache.ts` which wraps it with React `cache()`. Do not
 * import React `cache()` here — the static guard
 * (`tests/unit/architecture/no-adhoc-cache.test.ts`) forbids it.
 */

import "server-only";

import { forumApi } from "./forum-api";

export type SettingsMap = Record<string, string | number | boolean | object>;

export async function fetchPublicSettingsRaw(): Promise<SettingsMap> {
	const res = await forumApi.get<SettingsMap>("/api/v1/settings");
	return res.data;
}
