// @ellie/shared — Shared utilities and types

export type { ApiErrorData } from "./api-error";
// API Error
export { ApiError } from "./api-error";

// Viewmodels
export type { BreadcrumbItem } from "./viewmodels/breadcrumbs";
export {
	formatCompactNumber,
	formatDate,
	formatDateTime,
	formatLocaleDate,
	formatNumber,
	formatRelativeTime,
} from "./viewmodels/formatting";
export {
	emptyPage,
	generatePageNumbers,
	type PageItem,
	type PaginatedResult,
} from "./viewmodels/pagination";
export { parseIntParam, parsePageParam } from "./viewmodels/params";
