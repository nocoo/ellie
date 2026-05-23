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

function shanghaiNow(): Date {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).formatToParts(new Date());

	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
	return new Date(
		Date.UTC(
			Number(get("year")),
			Number(get("month")) - 1,
			Number(get("day")),
			Number(get("hour")),
			Number(get("minute")),
			Number(get("second")),
		),
	);
}

function shanghaiStartOfDay(date: Date): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);

	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
	const utcMidnight = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
	return Math.floor((utcMidnight - 8 * 3600 * 1000) / 1000);
}

export function timeRangeToBounds(
	range: TimeRange,
	customStart?: number,
	customEnd?: number,
): { min: number; max: number } {
	if (range === "custom") {
		return { min: customStart ?? 0, max: customEnd ?? Math.floor(Date.now() / 1000) };
	}

	const now = shanghaiNow();
	const max = Math.floor(Date.now() / 1000);

	let min: number;
	switch (range) {
		case "today":
			min = shanghaiStartOfDay(now);
			break;
		case "7d":
			min = shanghaiStartOfDay(new Date(now.getTime() - 6 * 86400 * 1000));
			break;
		case "30d":
			min = shanghaiStartOfDay(new Date(now.getTime() - 29 * 86400 * 1000));
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
