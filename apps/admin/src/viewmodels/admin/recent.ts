import { type PaginatedResponse, apiClient } from "@/lib/api-client";
import type { Attachment } from "./attachments";
import type { Post } from "./posts";
import type { Thread } from "./threads";
import type { User } from "./users";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimeRange = "today" | "7d" | "30d" | "custom";
export type TabKey = "users" | "threads" | "posts" | "attachments";

export const TAB_LABELS: Record<TabKey, string> = {
	users: "新用户",
	threads: "新主题",
	posts: "新回复",
	attachments: "新附件",
};

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
	today: "今天",
	"7d": "7天",
	"30d": "30天",
	custom: "自定义",
};

// ---------------------------------------------------------------------------
// Time helpers (Asia/Shanghai)
// ---------------------------------------------------------------------------

/**
 * Extract year/month/day in Asia/Shanghai from a real Date, then compute the
 * UTC unix seconds for that Shanghai date at 00:00:00 CST (= UTC-8h).
 *
 * This avoids the broken pattern of constructing a "fake UTC Date" from
 * Shanghai parts and then formatting it with Asia/Shanghai again.
 */
function shanghaiMidnightUnix(realDate: Date): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(realDate);

	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
	const utcMidnight = Date.UTC(get("year"), get("month") - 1, get("day"));
	return Math.floor((utcMidnight - 8 * 3600_000) / 1000);
}

/**
 * Parse a "YYYY-MM-DD" date string as Shanghai midnight (start of day) or
 * end of day (23:59:59 CST). Returns unix seconds.
 */
export function shanghaiDateStringToUnix(dateStr: string, endOfDay = false): number {
	const parts = dateStr.split("-").map(Number);
	const utcMidnight = Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
	const shanghaiMidnight = Math.floor((utcMidnight - 8 * 3600_000) / 1000);
	return endOfDay ? shanghaiMidnight + 86400 - 1 : shanghaiMidnight;
}

export function timeRangeToBounds(
	range: TimeRange,
	customStart?: string,
	customEnd?: string,
): { min: number; max: number } {
	if (range === "custom") {
		const min = customStart ? shanghaiDateStringToUnix(customStart) : 0;
		const max = customEnd
			? shanghaiDateStringToUnix(customEnd, true)
			: Math.floor(Date.now() / 1000);
		return { min, max };
	}

	const now = new Date();
	const max = Math.floor(Date.now() / 1000);

	let min: number;
	switch (range) {
		case "today":
			min = shanghaiMidnightUnix(now);
			break;
		case "7d":
			min = shanghaiMidnightUnix(new Date(now.getTime() - 6 * 86400_000));
			break;
		case "30d":
			min = shanghaiMidnightUnix(new Date(now.getTime() - 29 * 86400_000));
			break;
	}

	return { min, max };
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export async function fetchRecentUsers(
	min: number,
	max: number,
	page = 1,
	limit = 20,
): Promise<PaginatedResponse<User>> {
	return apiClient.getList<User>("/api/admin/users", {
		regDateMin: min,
		regDateMax: max,
		page,
		limit,
	});
}

export async function fetchRecentThreads(
	min: number,
	max: number,
	page = 1,
	limit = 20,
): Promise<PaginatedResponse<Thread>> {
	return apiClient.getList<Thread>("/api/admin/threads", {
		createdAtMin: min,
		createdAtMax: max,
		page,
		limit,
	});
}

export async function fetchRecentPosts(
	min: number,
	max: number,
	page = 1,
	limit = 20,
): Promise<PaginatedResponse<Post>> {
	return apiClient.getList<Post>("/api/admin/posts", {
		createdAtMin: min,
		createdAtMax: max,
		isFirst: 0,
		page,
		limit,
	});
}

export async function fetchRecentAttachments(
	min: number,
	max: number,
	page = 1,
	limit = 20,
): Promise<PaginatedResponse<Attachment>> {
	return apiClient.getList<Attachment>("/api/admin/attachments", {
		createdAtMin: min,
		createdAtMax: max,
		page,
		limit,
	});
}
