// @ellie/shared — Shared utilities and types

// API Error
export { ApiError } from "./api-error";
export type { ApiErrorData } from "./api-error";

// Viewmodels
export type { BreadcrumbItem } from "./viewmodels/breadcrumbs";
export {
	formatNumber,
	formatCompactNumber,
	formatDate,
	formatDateTime,
	formatLocaleDate,
	formatRelativeTime,
} from "./viewmodels/formatting";
export {
	type PaginatedResult,
	type PageItem,
	emptyPage,
	generatePageNumbers,
} from "./viewmodels/pagination";
export { parseIntParam, parsePageParam } from "./viewmodels/params";
