import type {
	MemoryCacheErrorCode,
	MemoryCacheFamilyId,
	MemoryCacheMutation,
	MemoryCacheOverview,
	MemoryCacheQuery,
} from "@ellie/types";
import { MEMORY_CACHE_ERROR_CODES } from "@ellie/types";

import { ApiError, apiClient } from "@/lib/api-client";

export const MEMORY_FAMILY_LABELS: Record<MemoryCacheFamilyId, string> = {
	"home-display": "首页展示",
	"site-stats": "站点统计",
	"forum-summary": "版块摘要",
	"thread-count": "主题计数",
	"forum-list": "版块列表",
};

export class MemoryCacheRequestError extends Error {
	readonly code: MemoryCacheErrorCode;

	constructor(code: MemoryCacheErrorCode, message: string) {
		super(message);
		this.name = "MemoryCacheRequestError";
		this.code = code;
	}
}

async function requestMemoryCache<T>(
	method: "GET" | "POST",
	search: string,
	body?: unknown,
): Promise<T> {
	try {
		const path = `/api/admin/memory-cache${search}`;
		const response =
			method === "GET" ? await apiClient.get<T>(path) : await apiClient.post<T>(path, body);
		if (response.data === undefined) throw new Error("Missing response data");
		return response.data;
	} catch (error) {
		if (
			error instanceof ApiError &&
			(MEMORY_CACHE_ERROR_CODES as readonly string[]).includes(error.code)
		) {
			throw new MemoryCacheRequestError(error.code as MemoryCacheErrorCode, error.message);
		}
		throw new MemoryCacheRequestError("UPSTREAM_UNAVAILABLE", "内存缓存管理接口不可达");
	}
}

export function fetchMemoryOverview(query: MemoryCacheQuery): Promise<MemoryCacheOverview> {
	const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
	if (query.family) params.set("family", query.family);
	return requestMemoryCache<MemoryCacheOverview>("GET", `?${params.toString()}`);
}

export function mutateMemoryCache(mutation: MemoryCacheMutation): Promise<{ ok: true }> {
	return requestMemoryCache<{ ok: true }>("POST", "", mutation);
}

export function formatUptime(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "—";
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return `${Math.floor(ms / 1000)} 秒`;
	const hours = Math.floor(minutes / 60);
	if (hours < 1) return `${minutes} 分钟`;
	const days = Math.floor(hours / 24);
	if (days < 1) return `${hours} 小时 ${minutes % 60} 分`;
	return `${days} 天 ${hours % 24} 小时`;
}

export function formatTimestamp(iso: string | null | undefined): string {
	if (!iso) return "—";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

export function hitRateLabel(hits: number, misses: number): string {
	const total = hits + misses;
	if (!Number.isFinite(total) || total <= 0) return "—";
	return `${((hits / total) * 100).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`;
}

export function remainingMs(expiresAt: string, now: number = Date.now()): number | null {
	const at = new Date(expiresAt).getTime();
	return Number.isNaN(at) ? null : at - now;
}

export function entryPages(total: number, limit: number): number {
	if (!Number.isFinite(total) || !Number.isFinite(limit) || total <= 0 || limit <= 0) return 1;
	return Math.ceil(total / limit);
}

export interface HistoryChartRow {
	x: number;
	payloadBytes: number;
	pendingViews: number;
}

export function historyChartRows(history: MemoryCacheOverview["history"]): HistoryChartRow[] {
	const rows: HistoryChartRow[] = [];
	for (const sample of history) {
		const at = new Date(sample.at).getTime();
		if (Number.isNaN(at)) continue;
		rows.push({
			x: at,
			payloadBytes: Number.isFinite(sample.estimatedPayloadBytes)
				? sample.estimatedPayloadBytes
				: 0,
			pendingViews: Number.isFinite(sample.pendingViews) ? sample.pendingViews : 0,
		});
	}
	return rows.sort((a, b) => a.x - b.x);
}

export function instanceChanged(
	previous: Pick<MemoryCacheOverview["instance"], "id"> | null | undefined,
	next: Pick<MemoryCacheOverview["instance"], "id">,
): boolean {
	if (!previous) return false;
	return previous.id !== next.id;
}

export function payloadShareLabel(overview: MemoryCacheOverview): string {
	const { estimatedPayloadBytes, payloadLimitBytes } = overview.memory;
	if (!Number.isFinite(estimatedPayloadBytes) || !Number.isFinite(payloadLimitBytes)) return "—";
	if (payloadLimitBytes <= 0) return "—";
	const percent = (estimatedPayloadBytes / payloadLimitBytes) * 100;
	return `${percent.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`;
}
