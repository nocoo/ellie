// viewmodels/admin/user-checkin.ts — Admin user-detail check-in panel.
// Wraps the three Phase E worker endpoints (proxied through Next admin BFF):
//
//   GET   /api/admin/users/:id/checkins?from=&to=
//   PATCH /api/admin/users/:id/checkins/:dateLocal       { checkedIn }
//   PATCH /api/admin/users/:id/checkins/streak           { streakDays }
//
// Returned shapes mirror @ellie/types so the Page can render aggregate +
// per-day audit history without remapping. Streak override response carries
// a `note` warning that the manual value will be overwritten by the next
// history-based recompute (see Phase E reviewer thread).

import { apiClient } from "@/lib/api-client";
import type { CheckinHistoryEntry, UserCheckin } from "@ellie/types";

export interface UserCheckinDetail {
	userId: number;
	username: string;
	checkin: UserCheckin | null;
	history: CheckinHistoryEntry[];
	range: { from: string; to: string };
	truncated: boolean;
}

export interface SetCheckinDayResult {
	userId: number;
	dateLocal: string;
	checkedIn: boolean;
	recompute: {
		totalDays: number;
		monthDays: number;
		streakDays: number;
		rewardTotal: number;
		lastCheckinAt: number;
		historyRows: number;
		skipped: boolean;
	};
}

export interface SetStreakResult {
	userId: number;
	streakDays: number;
	note: string;
}

export interface CheckinRange {
	from?: string;
	to?: string;
}

export async function fetchUserCheckins(
	id: number,
	range: CheckinRange = {},
): Promise<UserCheckinDetail> {
	const params: Record<string, string> = {};
	if (range.from) params.from = range.from;
	if (range.to) params.to = range.to;
	const res = await apiClient.get<UserCheckinDetail>(
		`/api/admin/users/${id}/checkins`,
		Object.keys(params).length > 0 ? params : undefined,
	);
	return res.data;
}

export async function setCheckinDay(
	id: number,
	dateLocal: string,
	checkedIn: boolean,
): Promise<SetCheckinDayResult> {
	const res = await apiClient.patch<SetCheckinDayResult>(
		`/api/admin/users/${id}/checkins/${encodeURIComponent(dateLocal)}`,
		{ checkedIn },
	);
	return res.data;
}

export async function setUserStreak(id: number, streakDays: number): Promise<SetStreakResult> {
	const res = await apiClient.patch<SetStreakResult>(`/api/admin/users/${id}/checkins/streak`, {
		streakDays,
	});
	return res.data;
}
