import "server-only";

import { EMPTY_HOME_STATS, type HomeStats } from "@ellie/types";
import { getDailyStatistics } from "@/lib/daily-statistics";

export type SiteStats = HomeStats;

export async function loadSiteStats(): Promise<SiteStats> {
	return (await getDailyStatistics().read())?.stats ?? { ...EMPTY_HOME_STATS };
}
