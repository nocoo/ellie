import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CensorWord {
	id: number;
	find: string;
	replacement: string;
	action: "ban" | "replace";
	adminId: number;
	adminName: string;
	createdAt: number;
}

export interface CensorWordFilters {
	find?: string;
	action?: string;
	page?: number;
	limit?: number;
}

export interface CensorWordCreate {
	find: string;
	replacement?: string;
	action?: "ban" | "replace";
}

export interface CensorWordUpdate {
	find?: string;
	replacement?: string;
	action?: "ban" | "replace";
}

export interface BatchResult {
	affected: number;
}

export interface TestContentResult {
	original: string;
	censored: string;
	matches: string[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Build search params from CensorWordFilters, omitting empty values. */
export function buildCensorWordSearchParams(
	filters: CensorWordFilters,
): Record<string, string | number | boolean | undefined | null> {
	return {
		page: filters.page,
		limit: filters.limit,
		find: filters.find || undefined,
		action: filters.action || undefined,
	};
}

/** Return a display-friendly replacement string. */
export function replacementDisplay(replacement: string): string {
	return replacement || "***";
}

/** Return a display label for censor word action. */
export function actionLabel(action: "ban" | "replace"): string {
	return action === "ban" ? "Ban" : "Replace";
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchCensorWords(
	filters: CensorWordFilters,
): Promise<PaginatedResponse<CensorWord>> {
	return apiClient.getList<CensorWord>(
		"/api/admin/censor-words",
		buildCensorWordSearchParams(filters),
	);
}

export async function fetchCensorWord(id: number): Promise<CensorWord> {
	const res = await apiClient.get<CensorWord>(`/api/admin/censor-words/${id}`);
	return res.data;
}

export async function createCensorWord(data: CensorWordCreate): Promise<CensorWord> {
	const res = await apiClient.post<CensorWord>("/api/admin/censor-words", data);
	return res.data;
}

export async function updateCensorWord(id: number, data: CensorWordUpdate): Promise<CensorWord> {
	const res = await apiClient.patch<CensorWord>(`/api/admin/censor-words/${id}`, data);
	return res.data;
}

export async function deleteCensorWord(id: number): Promise<void> {
	await apiClient.delete(`/api/admin/censor-words/${id}`);
}

export async function batchDeleteCensorWords(ids: number[]): Promise<BatchResult> {
	const res = await apiClient.post<BatchResult>("/api/admin/censor-words/batch-delete", { ids });
	return res.data;
}

export async function testContent(content: string): Promise<TestContentResult> {
	const res = await apiClient.post<TestContentResult>("/api/admin/censor-words/test", { content });
	return res.data;
}
