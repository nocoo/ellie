/**
 * Settings server-only API functions.
 * Only used from Server Components (admin settings page).
 */

import "server-only";
import { adminApi } from "@/lib/admin-api";
import type { SettingsDetailMap } from "./settings";

export async function fetchSettingsDetailed(prefix?: string): Promise<SettingsDetailMap> {
	const url = prefix
		? `/api/admin/settings?prefix=${encodeURIComponent(prefix)}`
		: "/api/admin/settings";
	const res = await adminApi.get<SettingsDetailMap>(url);
	return res.data;
}
