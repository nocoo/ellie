/**
 * Server-side settings helper for forum pages.
 * Fetches settings from Worker API with Next.js request-level caching.
 */

import "server-only";

import { cache } from "react";
import { forumApi } from "./forum-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForumSettings {
	pageSize: number;
	postsPerPage: number;
	maxPostLength: number;
}

interface SettingsResponse {
	[key: string]: string | number | boolean | object;
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_POSTS_PER_PAGE = 20;
const DEFAULT_MAX_POST_LENGTH = 50000;

// ---------------------------------------------------------------------------
// Cached settings fetch
// ---------------------------------------------------------------------------

/**
 * Get forum settings from Worker API.
 * Uses React cache() to dedupe requests within the same render.
 */
export const getForumSettings = cache(async (): Promise<ForumSettings> => {
	try {
		const { data } = await forumApi.get<SettingsResponse>("/api/v1/settings");

		return {
			pageSize: parseNumber(data["general.pagination.page_size"], DEFAULT_PAGE_SIZE),
			postsPerPage: parseNumber(data["general.pagination.posts_per_page"], DEFAULT_POSTS_PER_PAGE),
			maxPostLength: parseNumber(
				data["general.pagination.max_post_length"],
				DEFAULT_MAX_POST_LENGTH,
			),
		};
	} catch {
		// Fallback to defaults if settings fetch fails
		return {
			pageSize: DEFAULT_PAGE_SIZE,
			postsPerPage: DEFAULT_POSTS_PER_PAGE,
			maxPostLength: DEFAULT_MAX_POST_LENGTH,
		};
	}
});

/**
 * Get just the page size setting (convenience function).
 */
export async function getPageSize(): Promise<number> {
	const settings = await getForumSettings();
	return settings.pageSize;
}

/**
 * Get posts per page setting for thread detail pages.
 */
export async function getPostsPerPage(): Promise<number> {
	const settings = await getForumSettings();
	return settings.postsPerPage;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumber(value: unknown, defaultValue: number): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const n = Number.parseInt(value, 10);
		return Number.isNaN(n) ? defaultValue : n;
	}
	return defaultValue;
}
