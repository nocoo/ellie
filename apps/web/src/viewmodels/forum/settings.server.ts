/**
 * Public settings server-only reader.
 * Used by forum Server Components to read typed settings via Key A.
 */

import "server-only";
import { forumApi } from "@/lib/forum-api";

export type SettingsMap = Record<string, string | number | boolean | object>;

export async function fetchPublicSettings(): Promise<SettingsMap> {
	const res = await forumApi.get<SettingsMap>("/api/v1/settings");
	return res.data;
}
