/**
 * Dashboard server-only API functions.
 * Only used from Server Components.
 */

import { adminApi } from "@/lib/admin-api";
import type { DashboardStats } from "./dashboard";

export async function fetchDashboardStats(): Promise<DashboardStats> {
	const res = await adminApi.get<DashboardStats>("/api/admin/stats");
	return res.data;
}
