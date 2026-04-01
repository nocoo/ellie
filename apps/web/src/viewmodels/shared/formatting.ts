// viewmodels/shared/formatting.ts — Unified date/time formatting utilities
// Single source of truth for timestamp display across forum pages.
// All functions accept Unix epoch seconds (not milliseconds).

// ---------------------------------------------------------------------------
// Absolute formatters
// ---------------------------------------------------------------------------

/**
 * Format timestamp to absolute date: "2003-7-14" (no zero-padding).
 * Returns empty string for zero/invalid timestamps.
 */
export function formatDate(timestamp: number): string {
	if (timestamp === 0) return "";
	const d = new Date(timestamp * 1000);
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Format timestamp to absolute date-time: "2013-5-19 23:40".
 * Date part has no zero-padding; hours/minutes are zero-padded.
 * Returns empty string for zero/invalid timestamps.
 */
export function formatDateTime(timestamp: number): string {
	if (timestamp === 0) return "";
	const d = new Date(timestamp * 1000);
	const h = String(d.getHours()).padStart(2, "0");
	const m = String(d.getMinutes()).padStart(2, "0");
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${h}:${m}`;
}

/**
 * Format timestamp to locale date with zero-padding: "2024/01/05".
 * Returns null for zero/negative timestamps.
 * Used for profile "last activity" displays.
 */
export function formatLocaleDate(timestamp: number): string | null {
	if (timestamp <= 0) return null;
	const d = new Date(timestamp * 1000);
	return d.toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
}

// ---------------------------------------------------------------------------
// Relative formatter
// ---------------------------------------------------------------------------

/**
 * Format timestamp as relative time if recent, absolute date otherwise.
 * - < 60s: "刚刚"
 * - < 1h: "X 分钟前"
 * - < 24h: "X 小时前"
 * - < 30d: "X 天前"
 * - older: locale date string (zh-CN)
 *
 * Returns empty string for zero timestamps.
 */
export function formatRelativeTime(timestamp: number): string {
	if (timestamp === 0) return "";
	const now = Date.now() / 1000;
	const diff = now - timestamp;
	if (diff < 60) return "刚刚";
	if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
	if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
	if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
	return new Date(timestamp * 1000).toLocaleDateString("zh-CN");
}
