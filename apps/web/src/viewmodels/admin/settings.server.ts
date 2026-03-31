/**
 * Settings server-only API functions.
 * Only used from Server Components (admin settings page).
 */

import "server-only";
import { adminApi } from "@/lib/admin-api";
import type { SettingsDetailMap } from "./settings";

export async function fetchSettingsDetailed(): Promise<SettingsDetailMap> {
	const res = await adminApi.get<SettingsDetailMap>("/api/admin/settings");
	return res.data;
}
